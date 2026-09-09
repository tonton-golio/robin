'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog';

export type DocumentMode = 'view' | 'edit';

export type DocumentWriteState =
  | { kind: 'read-only' }
  | { kind: 'saved'; at?: string }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'stale'; modifiedAt?: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'error'; message: string };

export interface ActiveDocumentDescriptor {
  path: string;
  mode?: DocumentMode;
  writeState: DocumentWriteState;
  updatedAt?: string;
  save?: () => Promise<boolean>;
  discard?: () => void;
}

interface RegisteredDocument extends ActiveDocumentDescriptor {
  token: symbol;
}

interface ActiveDocumentContextValue {
  document: ActiveDocumentDescriptor | null;
  register: (descriptor: ActiveDocumentDescriptor) => () => void;
  update: (patch: Partial<ActiveDocumentDescriptor>) => void;
  requestNavigation: (href: string) => void;
  hasDirtyDocument: boolean;
}

const noop = () => {};
const ActiveDocumentContext = createContext<ActiveDocumentContextValue>({
  document: null,
  register: () => noop,
  update: noop,
  requestNavigation: noop,
  hasDirtyDocument: false,
});

export function ActiveDocumentProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [registered, setRegistered] = useState<RegisteredDocument | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const recoveryRef = useRef<HTMLButtonElement>(null);
  const navigationFocusRef = useRef<HTMLElement | null>(null);

  const register = useCallback((descriptor: ActiveDocumentDescriptor) => {
    const token = Symbol(descriptor.path);
    setRegistered({ ...descriptor, token });
    return () => {
      setRegistered((current) => (current?.token === token ? null : current));
    };
  }, []);

  const update = useCallback((patch: Partial<ActiveDocumentDescriptor>) => {
    setRegistered((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const hasDirtyDocument =
    Boolean(registered?.save) &&
    (registered?.writeState.kind === 'dirty' ||
      registered?.writeState.kind === 'error' ||
      registered?.writeState.kind === 'conflict');

  const requestNavigation = useCallback(
    (href: string) => {
      if (!href || href === pathname) return;
      if (
        registered?.save &&
        (registered.writeState.kind === 'dirty' ||
          registered.writeState.kind === 'error' ||
          registered.writeState.kind === 'conflict')
      ) {
        if (document.activeElement instanceof HTMLElement) {
          navigationFocusRef.current = document.activeElement;
        }
        setSaveError(null);
        setPendingHref(href);
        return;
      }
      router.push(href);
    },
    [pathname, registered, router],
  );

  const finishNavigation = useCallback(
    (href: string | null) => {
      const returnTarget = navigationFocusRef.current;
      navigationFocusRef.current = null;
      setPendingHref(null);
      setSaveError(null);
      if (href) {
        router.push(href);
        return;
      }
      window.setTimeout(() => {
        if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
      }, 0);
    },
    [router],
  );

  const saveAndContinue = useCallback(async () => {
    if (!registered?.save || !pendingHref) return;
    setSaving(true);
    setSaveError(null);
    try {
      const ok = await registered.save();
      if (!ok) {
        setSaveError('The file was not saved. Fix the error or discard the unsaved changes.');
        requestAnimationFrame(() => recoveryRef.current?.focus());
        return;
      }
      finishNavigation(pendingHref);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The file was not saved.');
      requestAnimationFrame(() => recoveryRef.current?.focus());
    } finally {
      setSaving(false);
    }
  }, [finishNavigation, pendingHref, registered]);

  const discardAndContinue = useCallback(() => {
    const href = pendingHref;
    registered?.discard?.();
    finishNavigation(href);
  }, [finishNavigation, pendingHref, registered]);

  useEffect(() => {
    if (!hasDirtyDocument) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasDirtyDocument]);

  useEffect(() => {
    if (!hasDirtyDocument) return;
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== '_self')) return;
      const rawHref = anchor.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#')) return;
      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (destination.origin !== window.location.origin) return;
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      requestNavigation(
        `${destination.pathname}${destination.search}${destination.hash}`,
      );
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [hasDirtyDocument, requestNavigation]);

  useEffect(() => {
    const save = registered?.save;
    if (!save) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      if (
        registered.writeState.kind !== 'dirty' &&
        registered.writeState.kind !== 'error' &&
        registered.writeState.kind !== 'conflict'
      ) {
        return;
      }
      event.preventDefault();
      void save();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [registered]);

  const value = useMemo<ActiveDocumentContextValue>(
    () => ({
      document: registered,
      register,
      update,
      requestNavigation,
      hasDirtyDocument,
    }),
    [registered, register, update, requestNavigation, hasDirtyDocument],
  );

  return (
    <ActiveDocumentContext.Provider value={value}>
      {children}
      <DialogRoot
        open={pendingHref !== null}
        onOpenChange={(open) => {
          if (!open && !saving) {
            finishNavigation(null);
          }
        }}
      >
        <DialogPortal>
          <DialogOverlay />
          <DialogContent
            className="workspace-save-dialog"
            onOpenAutoFocus={(event) => {
              if (!saveError) return;
              event.preventDefault();
              recoveryRef.current?.focus();
            }}
          >
            <DialogHeader>
              <div>
                <DialogTitle>Unsaved changes</DialogTitle>
                <DialogDescription>
                  Save this file before leaving, discard the changes, or stay here.
                </DialogDescription>
              </div>
            </DialogHeader>
            <DialogBody>
              <p className="workspace-save-path">{registered?.path}</p>
              {saveError ? (
                <div className="workspace-inline-error" role="alert">
                  {saveError}
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <button
                ref={recoveryRef}
                type="button"
                className="workspace-button workspace-button--primary"
                disabled={saving || !registered?.save}
                onClick={() => void saveAndContinue()}
              >
                {saving ? 'Saving…' : 'Save and leave'}
              </button>
              <button
                type="button"
                className="workspace-button workspace-button--danger"
                disabled={saving}
                onClick={discardAndContinue}
              >
                Discard changes
              </button>
              <button
                type="button"
                className="workspace-button"
                disabled={saving}
                onClick={() => finishNavigation(null)}
              >
                Stay here
              </button>
            </DialogFooter>
          </DialogContent>
        </DialogPortal>
      </DialogRoot>
    </ActiveDocumentContext.Provider>
  );
}

export function useActiveDocument() {
  return useContext(ActiveDocumentContext);
}

export function useActiveDocumentRegistration(descriptor: ActiveDocumentDescriptor) {
  const { register, update } = useActiveDocument();
  const path = descriptor.path;

  useEffect(() => register(descriptor), [path, register]);

  useEffect(() => {
    update(descriptor);
  }, [
    descriptor.mode,
    descriptor.updatedAt,
    descriptor.writeState.kind,
    descriptor.writeState.kind === 'saved' ? descriptor.writeState.at : undefined,
    descriptor.writeState.kind === 'stale' ? descriptor.writeState.modifiedAt : undefined,
    descriptor.writeState.kind === 'conflict' || descriptor.writeState.kind === 'error'
      ? descriptor.writeState.message
      : undefined,
    descriptor.save,
    descriptor.discard,
    update,
  ]);
}

export function ActiveDocumentRegistration({
  path,
  mode = 'view',
  writeState,
  updatedAt,
}: Omit<ActiveDocumentDescriptor, 'save' | 'discard'>) {
  useActiveDocumentRegistration({ path, mode, writeState, updatedAt });
  return null;
}
