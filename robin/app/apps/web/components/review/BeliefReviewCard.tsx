'use client';

import { useEffect, useRef, useState, type RefCallback } from 'react';
import type { BeliefReviewItem } from '@/lib/review';

interface BeliefReviewCardProps {
  item: BeliefReviewItem;
  busy: boolean;
  error?: string;
  primaryButtonRef: RefCallback<HTMLButtonElement>;
  onResolve: (
    item: BeliefReviewItem,
    status: 'active' | 'rejected',
    resolution: string,
  ) => Promise<void>;
}

export function BeliefReviewCard({
  item,
  busy,
  error,
  primaryButtonRef,
  onResolve,
}: BeliefReviewCardProps) {
  const headingId = `review-heading-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const rejectFormId = `${headingId}-reject`;
  const errorId = error ? `${headingId}-error` : undefined;
  const noteErrorId = `${rejectFormId}-note-error`;
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState(false);

  useEffect(() => {
    if (rejectOpen) noteRef.current?.focus();
  }, [rejectOpen]);

  const source = item.sources[0];

  return (
    <article
      className="review-card"
      data-kind="belief"
      aria-labelledby={headingId}
      aria-describedby={errorId}
      aria-busy={busy}
    >
      <header className="review-card__header">
        <div>
          <p className="review-card__eyebrow">
            Belief · {item.memoryType} · {item.confidence} confidence
          </p>
          <h2 id={headingId}>{item.subject}</h2>
        </div>
        <span className="r-pill" data-status="waiting">Tentative</span>
      </header>

      <div className="review-card__body">
        <p className="review-card__summary">{item.summary}</p>
        {item.body && item.body !== item.summary ? (
          <p className="review-card__secondary">{item.body}</p>
        ) : null}
        <div className="review-card__provenance">
          <span>Evidence</span>
          {source ? (
            <div>
              <p>{source.quote ? `“${source.quote}”` : source.ref}</p>
              <p className="r-mono">
                {source.kind} · {source.ref}
                {item.sourceCount > 1 ? ` · ${item.sourceCount} sources` : ''}
              </p>
            </div>
          ) : (
            <p>No source detail was recorded.</p>
          )}
        </div>
      </div>

      <div className="review-card__actions" aria-label={`Actions for ${item.subject}`}>
        <button
          ref={primaryButtonRef}
          type="button"
          className="r-btn r-btn--primary"
          disabled={busy}
          onClick={() => void onResolve(item, 'active', 'Confirmed in Review.')}
        >
          {busy && !rejectOpen ? 'Confirming…' : 'Confirm belief'}
        </button>
        <button
          type="button"
          className="r-btn r-btn--ghost"
          aria-expanded={rejectOpen}
          aria-controls={rejectFormId}
          disabled={busy}
          onClick={() => {
            setRejectOpen((open) => !open);
            setNoteError(false);
          }}
        >
          Reject
        </button>
      </div>

      {rejectOpen ? (
        <form
          id={rejectFormId}
          className="review-card__inline-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const resolution = note.trim();
            if (!resolution) {
              setNoteError(true);
              noteRef.current?.focus();
              return;
            }
            setNoteError(false);
            void onResolve(item, 'rejected', resolution);
          }}
        >
          <label htmlFor={`${rejectFormId}-note`}>Why is this belief wrong?</label>
          <textarea
            ref={noteRef}
            id={`${rejectFormId}-note`}
            rows={3}
            required
            value={note}
            aria-invalid={noteError}
            aria-describedby={noteError ? noteErrorId : undefined}
            onChange={(event) => {
              setNote(event.target.value);
              if (event.target.value.trim()) setNoteError(false);
            }}
          />
          {noteError ? (
            <p id={noteErrorId} className="review-card__field-error" role="alert">
              Add a short reason before rejecting this belief.
            </p>
          ) : null}
          <div className="review-card__form-actions">
            <button type="submit" className="r-btn r-btn--danger" disabled={busy}>
              {busy ? 'Rejecting…' : 'Reject belief'}
            </button>
            <button
              type="button"
              className="r-btn r-btn--ghost"
              disabled={busy}
              onClick={() => {
                setRejectOpen(false);
                setNoteError(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p id={errorId} className="review-card__error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
