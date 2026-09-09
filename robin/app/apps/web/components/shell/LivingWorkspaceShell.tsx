'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { WORKSPACE_CHORD_MAP } from '@/lib/workspaces';
import { ActiveDocumentProvider, useActiveDocument } from './ActiveDocumentProvider';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { WorkspaceTopbar } from './WorkspaceTopbar';
import { MobileWorkspaceNav } from './MobileWorkspaceNav';
import { FilesAndMoreDrawer } from './FilesAndMoreDrawer';
import { ContextDrawer } from './ContextDrawer';
import { CaptureDialog } from './CaptureDialog';
import { CommandPalette } from './CommandPalette';
import { CreatePageDialog } from './CreatePageDialog';
import { ShortcutSheet } from './ShortcutSheet';
import { useWorkspaceSummary } from './useWorkspaceSummary';
import { Annotator } from '@/components/annotate/Annotator';
import { WidgetProvider } from '@/components/widgets/WidgetProvider';
import { WidgetPanels } from '@/components/widgets/WidgetDock';

type ShellOverlay = 'search' | 'capture' | 'files' | 'context' | 'create' | 'shortcuts' | null;
const CHORD_WINDOW_MS = 800;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

function LivingWorkspaceContents({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const { requestNavigation } = useActiveDocument();
  const [overlay, setOverlay] = useState<ShellOverlay>(null);
  const [mobile, setMobile] = useState(false);
  const chordAtRef = useRef(0);
  const previousPath = useRef(pathname);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const summary = useWorkspaceSummary();

  const openOverlay = useCallback((next: Exclude<ShellOverlay, null>) => {
    if (document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
    setOverlay(next);
  }, []);

  const closeOverlay = useCallback(() => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    setOverlay(null);
    window.setTimeout(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
    }, 0);
  }, []);

  const changeOverlay = useCallback(
    (kind: Exclude<ShellOverlay, null>, open: boolean) => {
      if (open) {
        openOverlay(kind);
      } else {
        closeOverlay();
      }
    },
    [closeOverlay, openOverlay],
  );

  useEffect(() => {
    const query = window.matchMedia('(max-width: 820px)');
    const sync = () => {
      setMobile(query.matches);
      if (!query.matches) {
        setOverlay((current) => {
          if (current !== 'files') return current;
          returnFocusRef.current = null;
          return null;
        });
      }
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (overlay === 'search') closeOverlay();
        else openOverlay('search');
        return;
      }
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (overlay === 'create') closeOverlay();
        else openOverlay('create');
        return;
      }
      if (mod || event.altKey || isTypingTarget(event.target) || overlay) return;
      if (event.key === '?') {
        event.preventDefault();
        openOverlay('shortcuts');
        return;
      }
      if (event.key.toLowerCase() === 'g') {
        chordAtRef.current = Date.now();
        return;
      }
      if (chordAtRef.current && Date.now() - chordAtRef.current <= CHORD_WINDOW_MS) {
        const href = WORKSPACE_CHORD_MAP[event.key.toLowerCase()];
        chordAtRef.current = 0;
        if (href) {
          event.preventDefault();
          requestNavigation(href);
        }
        return;
      }
      chordAtRef.current = 0;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeOverlay, openOverlay, overlay, requestNavigation]);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    returnFocusRef.current = null;
    setOverlay(null);
    requestAnimationFrame(() => {
      document.getElementById('workspace-main')?.focus({ preventScroll: true });
    });
  }, [pathname]);

  useEffect(() => {
    const onCreate = () => openOverlay('create');
    const onShortcuts = () => openOverlay('shortcuts');
    window.addEventListener('robin:create', onCreate);
    window.addEventListener('robin:shortcuts', onShortcuts);
    return () => {
      window.removeEventListener('robin:create', onCreate);
      window.removeEventListener('robin:shortcuts', onShortcuts);
    };
  }, [openOverlay]);

  return (
    <div className="workspace-shell">
      <a className="workspace-skip-link" href="#workspace-main">
        Skip to content
      </a>

      {!mobile ? (
        <WorkspaceSidebar
          pathname={pathname}
          summary={summary}
          onMore={() => openOverlay('files')}
          moreOpen={overlay === 'files'}
        />
      ) : null}

      <div className="workspace-stage">
        <WorkspaceTopbar
          pathname={pathname}
          onFiles={() => openOverlay('files')}
          onSearch={() => openOverlay('search')}
          onCapture={() => openOverlay('capture')}
          onContext={() => openOverlay('context')}
          filesOpen={overlay === 'files'}
          searchOpen={overlay === 'search'}
          captureOpen={overlay === 'capture'}
          contextOpen={overlay === 'context'}
        />
        <main id="workspace-main" className="workspace-main" tabIndex={-1}>
          {children}
        </main>
      </div>

      <MobileWorkspaceNav
        pathname={pathname}
        summary={summary}
        onCapture={() => openOverlay('capture')}
        captureOpen={overlay === 'capture'}
      />

      <CommandPalette
        open={overlay === 'search'}
        onOpenChange={(open) => changeOverlay('search', open)}
      />
      <CaptureDialog
        open={overlay === 'capture'}
        onOpenChange={(open) => changeOverlay('capture', open)}
      />
      <FilesAndMoreDrawer
        open={overlay === 'files'}
        onOpenChange={(open) => changeOverlay('files', open)}
        pathname={pathname}
        summary={summary}
        showFiles={mobile}
      />
      <ContextDrawer
        open={overlay === 'context'}
        onOpenChange={(open) => changeOverlay('context', open)}
      />
      <CreatePageDialog
        open={overlay === 'create'}
        onOpenChange={(open) => changeOverlay('create', open)}
      />
      <ShortcutSheet
        open={overlay === 'shortcuts'}
        onOpenChange={(open) => changeOverlay('shortcuts', open)}
      />

      <Annotator pathname={pathname} />
      <WidgetPanels />
      <div className="workspace-route-announcer" aria-live="polite" aria-atomic="true">
        {pathname}
      </div>
    </div>
  );
}

export function LivingWorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <WidgetProvider>
      <ActiveDocumentProvider>
        <LivingWorkspaceContents>{children}</LivingWorkspaceContents>
      </ActiveDocumentProvider>
    </WidgetProvider>
  );
}
