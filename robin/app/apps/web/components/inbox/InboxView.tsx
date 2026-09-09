'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  Inbox,
  Mic,
  PanelRight,
  Radio,
  RefreshCw,
} from 'lucide-react';
import { useActiveDocumentRegistration } from '@/components/shell/ActiveDocumentProvider';
import type {
  CaptureSession,
  InboxData,
  RecoveryItem,
} from '@/lib/inbox/model';
import { InboxContext } from './InboxContext';
import {
  CaptureQueue,
  FiledHistory,
  RecoveryQueue,
} from './InboxRows';
import {
  captureSelectionKey,
  recoverySelectionKey,
  type InboxSelection,
} from './types';

function openCapture(kind: 'meeting' | 'interview') {
  window.dispatchEvent(
    new CustomEvent('robin:open-widget', { detail: kind }),
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}

function attentionTitle(count: number): string {
  if (count === 0) return 'Inbox is clear';
  return `${count} capture${count === 1 ? '' : 's'} need attention`;
}

export function InboxView({ data }: { data: InboxData }) {
  const router = useRouter();
  const { pending, recovery, history, stats, error } = data;
  const selectionKeys = useMemo(
    () => [
      ...recovery.map(recoverySelectionKey),
      ...pending.map(captureSelectionKey),
    ],
    [pending, recovery],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(
    selectionKeys[0] ?? null,
  );
  const [contextOpen, setContextOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const contextRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selectionKeys.length === 0) {
      setSelectedKey(null);
      setContextOpen(false);
    } else if (!selectedKey || !selectionKeys.includes(selectedKey)) {
      setSelectedKey(selectionKeys[0]!);
    }
  }, [selectedKey, selectionKeys]);

  const selection = useMemo<InboxSelection | null>(() => {
    const selectedRecovery = recovery.find(
      (item) => recoverySelectionKey(item) === selectedKey,
    );
    if (selectedRecovery) {
      return { type: 'recovery', item: selectedRecovery };
    }
    const selectedCapture = pending.find(
      (item) => captureSelectionKey(item) === selectedKey,
    );
    return selectedCapture ? { type: 'capture', item: selectedCapture } : null;
  }, [pending, recovery, selectedKey]);

  useActiveDocumentRegistration({
    path: selection?.item.sourcePath ?? 'Inbox · live',
    mode: 'view',
    writeState: { kind: 'read-only' },
    updatedAt: selection?.item.when,
  });

  const registerRef = useCallback(
    (key: string, element: HTMLButtonElement | null) => {
      if (element) rowRefs.current.set(key, element);
      else rowRefs.current.delete(key);
    },
    [],
  );

  const selectCapture = useCallback((item: CaptureSession) => {
    setSelectedKey(captureSelectionKey(item));
    setNotice(null);
  }, []);

  const selectRecovery = useCallback((item: RecoveryItem) => {
    setSelectedKey(recoverySelectionKey(item));
    setNotice(null);
  }, []);

  const runIngest = useCallback(
    async (item: CaptureSession) => {
      if (!item.ingestPath || busyId) return;
      setSelectedKey(captureSelectionKey(item));
      setBusyId(item.id);
      setIngestError(null);
      setNotice(null);
      try {
        const response = await fetch('/api/ingest/meeting', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: item.ingestPath }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            body.message || body.error || `HTTP ${response.status}`,
          );
        }
        setNotice(
          `${item.title} was ingested. Its raw source remains safe in the vault.`,
        );
        window.dispatchEvent(new CustomEvent('robin:workspace-summary'));
        router.refresh();
      } catch (caught) {
        setIngestError({
          id: item.id,
          message:
            caught instanceof Error ? caught.message : String(caught),
        });
      } finally {
        setBusyId(null);
      }
    },
    [busyId, router],
  );

  const moveSelection = useCallback(
    (delta: number) => {
      if (selectionKeys.length === 0) return;
      const current = selectedKey ? selectionKeys.indexOf(selectedKey) : -1;
      const next = Math.max(
        0,
        Math.min(
          selectionKeys.length - 1,
          (current === -1 ? 0 : current) + delta,
        ),
      );
      const key = selectionKeys[next]!;
      setSelectedKey(key);
      rowRefs.current.get(key)?.focus();
      rowRefs.current.get(key)?.scrollIntoView({ block: 'nearest' });
    },
    [selectedKey, selectionKeys],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && contextOpen) {
        event.preventDefault();
        setContextOpen(false);
        return;
      }
      if (event.altKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        openCapture('meeting');
        return;
      }
      if (event.altKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        openCapture('interview');
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === 'Enter' &&
        selection?.type === 'capture' &&
        selection.item.ingestPath
      ) {
        event.preventDefault();
        void runIngest(selection.item);
        return;
      }
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(-1);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [contextOpen, moveSelection, runIngest, selection]);

  useEffect(() => {
    if (contextOpen) contextRef.current?.focus();
  }, [contextOpen]);

  const attentionCount = stats.pending + stats.recovery;

  return (
    <div
      className={`inbox-page${contextOpen ? ' has-context' : ''}`}
      data-testid="inbox-view"
    >
      <div className="inbox-stage">
        <div className="inbox-document-stage">
          <article className="inbox-document">
            <header className="inbox-document-head">
              <div>
                <p className="inbox-eyebrow">
                  <Inbox size={15} strokeWidth={1.8} aria-hidden />
                  Inbox · captured material
                </p>
                <h1>{error ? 'Inbox could not be read' : attentionTitle(attentionCount)}</h1>
                <p className="inbox-lede">
                  {error
                    ? 'The vault was not changed. Retry the read or check system health.'
                    : 'Meeting and interview material lands here first. File reviewed meetings, recover interrupted work, and keep completed history out of the way.'}
                </p>
              </div>

              <div className="inbox-head-actions" aria-label="Capture tools">
                <button
                  type="button"
                  className="r-btn r-btn--primary"
                  onClick={() => openCapture('meeting')}
                >
                  <Radio size={16} strokeWidth={1.8} aria-hidden />
                  Meeting
                  <kbd>⌥M</kbd>
                </button>
                <button
                  type="button"
                  className="r-btn"
                  onClick={() => openCapture('interview')}
                >
                  <Mic size={16} strokeWidth={1.8} aria-hidden />
                  Interview
                  <kbd>⌥I</kbd>
                </button>
                <button
                  type="button"
                  className="inbox-icon-button"
                  aria-label="Open source context"
                  aria-expanded={contextOpen}
                  aria-controls="inbox-source-context"
                  disabled={!selection}
                  onClick={() => setContextOpen((open) => !open)}
                >
                  <PanelRight size={18} strokeWidth={1.7} aria-hidden />
                </button>
              </div>
            </header>

            {!error ? (
              <div className="inbox-meta" aria-label="Inbox status">
                <span>{stats.pending} raw</span>
                <span>{stats.recovery} recovery</span>
                <span>last ingest {stats.lastIngestLabel}</span>
                {stats.degraded ? (
                  <strong>Queue needs a filing pass</strong>
                ) : (
                  <span>sources stay in the vault</span>
                )}
              </div>
            ) : null}

            {notice ? (
              <div className="inbox-notice" role="status">
                <Check size={17} strokeWidth={2} aria-hidden />
                {notice}
              </div>
            ) : null}

            {error ? (
              <section className="inbox-load-error" role="alert">
                <h2>Capture sources are unavailable</h2>
                <p>
                  Robin could not read the meeting and interview folders. No
                  files were moved, filed, or deleted.
                </p>
                <code>{error}</code>
                <button
                  type="button"
                  className="r-btn r-btn--primary"
                  onClick={() => router.refresh()}
                >
                  <RefreshCw size={16} strokeWidth={1.8} aria-hidden />
                  Retry
                </button>
              </section>
            ) : (
              <>
                {recovery.length > 0 ? (
                  <section className="inbox-section" aria-labelledby="inbox-recovery-heading">
                    <div className="inbox-section-head">
                      <div>
                        <span>Recovery</span>
                        <h2 id="inbox-recovery-heading">
                          Safe sources from interrupted captures
                        </h2>
                      </div>
                      <span>{recovery.length}</span>
                    </div>
                    <RecoveryQueue
                      items={recovery}
                      selectedKey={selectedKey}
                      onSelect={selectRecovery}
                      registerRef={registerRef}
                    />
                  </section>
                ) : null}

                {pending.length > 0 ? (
                  <section className="inbox-section" aria-labelledby="inbox-raw-heading">
                    <div className="inbox-section-head">
                      <div>
                        <span>Ready to handle</span>
                        <h2 id="inbox-raw-heading">Raw captures</h2>
                      </div>
                      <span>{pending.length}</span>
                    </div>
                    <CaptureQueue
                      items={pending}
                      selectedKey={selectedKey}
                      busyId={busyId}
                      ingestError={ingestError}
                      onSelect={selectCapture}
                      onIngest={(item) => void runIngest(item)}
                      registerRef={registerRef}
                    />
                  </section>
                ) : null}

                {attentionCount === 0 ? (
                  <section className="inbox-clear">
                    <span className="inbox-clear-mark" aria-hidden>
                      <Check size={22} strokeWidth={1.8} />
                    </span>
                    <div>
                      <h2>Everything has a place</h2>
                      <p>
                        No raw captures or recovery sources need attention. Start
                        a meeting or interview when there is something new to keep.
                      </p>
                    </div>
                  </section>
                ) : null}

                <FiledHistory
                  items={history}
                  retainedSourceCount={stats.alreadyFiledSources}
                />
              </>
            )}
          </article>
        </div>

        {contextOpen ? (
          <button
            type="button"
            className="inbox-context-scrim"
            aria-label="Close source context"
            onClick={() => setContextOpen(false)}
          />
        ) : null}
        <div id="inbox-source-context">
          <InboxContext
            ref={contextRef}
            selection={selection}
            open={contextOpen}
            onClose={() => setContextOpen(false)}
          />
        </div>
      </div>
    </div>
  );
}
