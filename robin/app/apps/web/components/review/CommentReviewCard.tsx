'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type RefCallback } from 'react';
import type { CommentReviewItem } from '@/lib/review';

interface CommentReviewCardProps {
  item: CommentReviewItem;
  busy: boolean;
  error?: string;
  primaryButtonRef: RefCallback<HTMLButtonElement>;
  onResolve: (
    item: CommentReviewItem,
    status: 'resolved' | 'rejected',
    resolution: string,
  ) => Promise<void>;
}

export function CommentReviewCard({
  item,
  busy,
  error,
  primaryButtonRef,
  onResolve,
}: CommentReviewCardProps) {
  const headingId = `review-heading-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const resolveFormId = `${headingId}-resolve`;
  const rejectConfirmId = `${headingId}-reject`;
  const errorId = error ? `${headingId}-error` : undefined;
  const noteErrorId = `${resolveFormId}-note-error`;
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState(false);

  useEffect(() => {
    if (resolveOpen) noteRef.current?.focus();
  }, [resolveOpen]);

  return (
    <article
      className="review-card"
      data-kind="comment"
      aria-labelledby={headingId}
      aria-describedby={errorId}
      aria-busy={busy}
    >
      <header className="review-card__header">
        <div>
          <p className="review-card__eyebrow">
            Comment · needs attention{item.pageChanged ? ' · page changed' : ''}
          </p>
          <h2 id={headingId}>{item.title}</h2>
        </div>
        {item.pageHref ? (
          <Link href={item.pageHref} className="review-card__record-link">
            Open page <span aria-hidden="true">↗</span>
          </Link>
        ) : null}
      </header>

      <div className="review-card__body">
        {item.comment ? (
          <p className="review-card__summary">{item.comment}</p>
        ) : (
          <p className="review-card__secondary">No written comment was recorded.</p>
        )}
        {item.quote ? <blockquote className="review-card__quote">{item.quote}</blockquote> : null}
        <p className="r-mono">
          {item.author ? `${item.author} · ` : ''}
          {item.pagePath ?? item.renderPath ?? 'page path unavailable'}
        </p>
        {item.pageChanged ? (
          <p className="review-card__warning">
            The page changed after this comment was placed. Check the current context before resolving.
          </p>
        ) : null}
      </div>

      <div className="review-card__actions" aria-label={`Actions for ${item.title}`}>
        <button
          ref={primaryButtonRef}
          type="button"
          className="r-btn r-btn--primary"
          aria-expanded={resolveOpen}
          aria-controls={resolveFormId}
          disabled={busy}
          onClick={() => {
            setResolveOpen((open) => !open);
            setRejectOpen(false);
            setNoteError(false);
          }}
        >
          Resolve
        </button>
        <button
          type="button"
          className="r-btn r-btn--ghost"
          aria-expanded={rejectOpen}
          aria-controls={rejectConfirmId}
          disabled={busy}
          onClick={() => {
            setRejectOpen((open) => !open);
            setResolveOpen(false);
            setNoteError(false);
          }}
        >
          Reject
        </button>
      </div>

      {resolveOpen ? (
        <form
          id={resolveFormId}
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
            void onResolve(item, 'resolved', resolution);
          }}
        >
          <label htmlFor={`${resolveFormId}-note`}>What closed this comment?</label>
          <textarea
            ref={noteRef}
            id={`${resolveFormId}-note`}
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
              Add a short resolution note before closing this comment.
            </p>
          ) : null}
          <div className="review-card__form-actions">
            <button type="submit" className="r-btn r-btn--primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save and resolve'}
            </button>
            <button
              type="button"
              className="r-btn r-btn--ghost"
              disabled={busy}
              onClick={() => {
                setResolveOpen(false);
                setNoteError(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {rejectOpen ? (
        <div id={rejectConfirmId} className="review-card__reject-confirm">
          <p>This marks the comment rejected. Robin will not act on it.</p>
          <div className="review-card__form-actions">
            <button
              type="button"
              className="r-btn r-btn--danger"
              disabled={busy}
              onClick={() => void onResolve(item, 'rejected', 'Rejected from Review.')}
            >
              {busy ? 'Rejecting…' : 'Confirm reject'}
            </button>
            <button
              type="button"
              className="r-btn r-btn--ghost"
              disabled={busy}
              onClick={() => setRejectOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p id={errorId} className="review-card__error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
