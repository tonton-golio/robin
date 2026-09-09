import { forwardRef } from 'react';
import { X } from 'lucide-react';
import type { InboxSelection } from './types';

interface InboxContextProps {
  selection: InboxSelection | null;
  open: boolean;
  onClose: () => void;
}

export const InboxContext = forwardRef<HTMLElement, InboxContextProps>(
  function InboxContext({ selection, open, onClose }, ref) {
    if (!open) return null;

    const item = selection?.item;
    return (
      <aside
        ref={ref}
        className="inbox-context"
        aria-labelledby="inbox-context-title"
        tabIndex={-1}
      >
        <header className="inbox-context-head">
          <div>
            <span className="inbox-context-eyebrow">Source context</span>
            <h2 id="inbox-context-title">
              {item?.title ?? 'No capture selected'}
            </h2>
          </div>
          <button
            type="button"
            className="inbox-icon-button"
            aria-label="Close source context"
            onClick={onClose}
          >
            <X size={18} strokeWidth={1.7} aria-hidden />
          </button>
        </header>

        {selection ? (
          <>
            <section className="inbox-context-section">
              <h3>Source of record</h3>
              <code className="inbox-context-path">{selection.item.sourcePath}</code>
              <dl className="inbox-context-facts">
                <div>
                  <dt>State</dt>
                  <dd>
                    {selection.type === 'capture'
                      ? 'Raw · not yet filed'
                      : 'Recovery source · unchanged'}
                  </dd>
                </div>
                <div>
                  <dt>Captured</dt>
                  <dd>
                    {selection.type === 'capture'
                      ? selection.item.whenLabel
                      : new Date(selection.item.when).toLocaleString()}
                  </dd>
                </div>
                {selection.type === 'capture' ? (
                  <div>
                    <dt>Kind</dt>
                    <dd>
                      {selection.item.kind === 'meeting' ? 'Meeting' : 'Interview'}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>

            {selection.type === 'capture' && selection.item.attendees.length > 0 ? (
              <section className="inbox-context-section">
                <h3>Attendees</h3>
                <ul className="inbox-context-tags">
                  {selection.item.attendees.map((attendee) => (
                    <li key={attendee}>{attendee}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {selection.type === 'capture' && selection.item.summary ? (
              <section className="inbox-context-section">
                <h3>Summary</h3>
                <p>{selection.item.summary}</p>
              </section>
            ) : null}

            {selection.type === 'capture' && selection.item.excerpt ? (
              <section className="inbox-context-section">
                <h3>Raw excerpt</h3>
                <p className="inbox-context-excerpt">{selection.item.excerpt}</p>
              </section>
            ) : null}

            {selection.type === 'recovery' ? (
              <section className="inbox-context-section">
                <h3>Recovery note</h3>
                <p>{selection.item.detail}</p>
                <p className="inbox-context-assurance">
                  Opening the source does not alter it. Robin leaves the recovery artifact in
                  place until you decide what to keep.
                </p>
              </section>
            ) : null}
          </>
        ) : (
          <p className="inbox-context-empty">
            Select a raw capture or recovery source to inspect its provenance.
          </p>
        )}
      </aside>
    );
  },
);
