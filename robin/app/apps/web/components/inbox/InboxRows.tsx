import Link from 'next/link';
import {
  AudioLines,
  ChevronDown,
  FileClock,
  History,
  Mic,
  Radio,
} from 'lucide-react';
import type {
  CaptureSession,
  RecoveryItem,
} from '@/lib/inbox/model';
import {
  captureSelectionKey,
  recoverySelectionKey,
} from './types';

interface CaptureQueueProps {
  items: CaptureSession[];
  selectedKey: string | null;
  busyId: string | null;
  ingestError: { id: string; message: string } | null;
  onSelect: (item: CaptureSession) => void;
  onIngest: (item: CaptureSession) => void;
  registerRef: (key: string, element: HTMLButtonElement | null) => void;
}

function kindLabel(item: CaptureSession): string {
  return item.kind === 'meeting' ? 'Meeting' : 'Interview';
}

function CaptureIcon({ kind }: { kind: CaptureSession['kind'] }) {
  return kind === 'meeting' ? (
    <Radio size={18} strokeWidth={1.7} aria-hidden />
  ) : (
    <Mic size={18} strokeWidth={1.7} aria-hidden />
  );
}

export function CaptureQueue({
  items,
  selectedKey,
  busyId,
  ingestError,
  onSelect,
  onIngest,
  registerRef,
}: CaptureQueueProps) {
  return (
    <ul className="inbox-entry-list">
      {items.map((item) => {
        const key = captureSelectionKey(item);
        const selected = key === selectedKey;
        const busy = busyId === item.id;
        const error = ingestError?.id === item.id ? ingestError.message : null;

        return (
          <li
            key={item.id}
            className={`inbox-entry${selected ? ' is-selected' : ''}`}
          >
            <div className="inbox-entry-line">
              <button
                ref={(element) => registerRef(key, element)}
                type="button"
                className="inbox-entry-select"
                aria-pressed={selected}
                onClick={() => onSelect(item)}
              >
                <span className="inbox-entry-icon">
                  <CaptureIcon kind={item.kind} />
                </span>
                <span className="inbox-entry-copy">
                  <span className="inbox-entry-kicker">
                    {kindLabel(item)} · raw
                  </span>
                  <strong>{item.title}</strong>
                  <span className="inbox-entry-path">{item.sourcePath}</span>
                  {item.summary ? (
                    <span className="inbox-entry-summary">{item.summary}</span>
                  ) : null}
                </span>
              </button>

              <div className="inbox-entry-actions">
                <span className="inbox-entry-time">{item.whenLabel}</span>
                {item.ingestPath ? (
                  <button
                    type="button"
                    className="r-btn r-btn--primary inbox-compact-action"
                    disabled={busy}
                    onClick={() => onIngest(item)}
                  >
                    {busy ? 'Ingesting…' : 'Ingest meeting'}
                  </button>
                ) : null}
                <a
                  className="r-btn r-btn--ghost inbox-compact-action"
                  href={item.href}
                >
                  Open raw
                </a>
              </div>
            </div>

            {error ? (
              <div className="inbox-inline-error" role="alert">
                <strong>Ingest failed.</strong> The raw source is still safe.
                <span>{error}</span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

interface RecoveryQueueProps {
  items: RecoveryItem[];
  selectedKey: string | null;
  onSelect: (item: RecoveryItem) => void;
  registerRef: (key: string, element: HTMLButtonElement | null) => void;
}

function RecoveryIcon({ item }: { item: RecoveryItem }) {
  if (item.kind === 'audio') {
    return <AudioLines size={18} strokeWidth={1.7} aria-hidden />;
  }
  if (item.kind === 'live-interview') {
    return <Mic size={18} strokeWidth={1.7} aria-hidden />;
  }
  return <FileClock size={18} strokeWidth={1.7} aria-hidden />;
}

export function RecoveryQueue({
  items,
  selectedKey,
  onSelect,
  registerRef,
}: RecoveryQueueProps) {
  return (
    <ul className="inbox-entry-list inbox-recovery-list">
      {items.map((item) => {
        const key = recoverySelectionKey(item);
        const selected = key === selectedKey;

        return (
          <li
            key={item.id}
            className={`inbox-entry inbox-recovery-entry${selected ? ' is-selected' : ''}${
              item.warn ? ' is-warning' : ''
            }`}
          >
            <div className="inbox-entry-line">
              <button
                ref={(element) => registerRef(key, element)}
                type="button"
                className="inbox-entry-select"
                aria-pressed={selected}
                onClick={() => onSelect(item)}
              >
                <span className="inbox-entry-icon">
                  <RecoveryIcon item={item} />
                </span>
                <span className="inbox-entry-copy">
                  <span className="inbox-entry-kicker">
                    {item.warn ? 'Interrupted' : 'Recovery source'}
                  </span>
                  <strong>{item.title}</strong>
                  <span className="inbox-entry-path">{item.sourcePath}</span>
                  <span className="inbox-entry-summary">{item.detail}</span>
                </span>
              </button>
              <div className="inbox-entry-actions">
                <a
                  className="r-btn inbox-compact-action"
                  href={item.href}
                >
                  Open recovery source
                </a>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function FiledHistory({
  items,
  retainedSourceCount,
}: {
  items: CaptureSession[];
  retainedSourceCount: number;
}) {
  if (items.length === 0 && retainedSourceCount === 0) return null;

  return (
    <details className="inbox-history">
      <summary>
        <span className="inbox-history-label">
          <History size={17} strokeWidth={1.7} aria-hidden />
          Filed history
        </span>
        <span className="inbox-history-count">
          {items.length} {items.length === 1 ? 'page' : 'pages'}
          <ChevronDown size={15} strokeWidth={1.7} aria-hidden />
        </span>
      </summary>
      <div className="inbox-history-body">
        {items.length > 0 ? (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <Link href={item.href}>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.sourcePath}</small>
                  </span>
                  <span className="inbox-history-when">{item.whenLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>No durable capture pages yet.</p>
        )}
        {retainedSourceCount > 0 ? (
          <p className="inbox-history-note">
            {retainedSourceCount} filed raw{' '}
            {retainedSourceCount === 1 ? 'source remains' : 'sources remain'} safely in the
            vault and no longer appear in the action queue.
          </p>
        ) : null}
      </div>
    </details>
  );
}
