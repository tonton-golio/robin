'use client';

import Link from 'next/link';
import type { RefCallback } from 'react';
import type { InterventionResolution } from '@/lib/interventions';
import type { DecisionReviewItem } from '@/lib/review';

interface DecisionReviewCardProps {
  item: DecisionReviewItem;
  busy: boolean;
  error?: string;
  primaryButtonRef: RefCallback<HTMLButtonElement>;
  onResolve: (
    item: DecisionReviewItem,
    resolution: InterventionResolution,
  ) => Promise<void>;
}

function evidenceLabel(value: string): string {
  if (value === 'conflicting' || value === 'conflicting evidence') {
    return 'Conflicting evidence';
  }
  if (value === 'reported') return 'Reported';
  if (value === 'confirmed') return 'Confirmed';
  if (value === 'stale') return 'Checkpoint passed';
  return 'Tentative';
}

export function DecisionReviewCard({
  item,
  busy,
  error,
  primaryButtonRef,
  onResolve,
}: DecisionReviewCardProps) {
  const headingId = `review-heading-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const errorId = error ? `${headingId}-error` : undefined;

  return (
    <article
      className="review-card"
      data-kind="decision"
      aria-labelledby={headingId}
      aria-describedby={errorId}
      aria-busy={busy}
    >
      <header className="review-card__header">
        <div>
          <p className="review-card__eyebrow">Decision · {evidenceLabel(item.evidenceState)}</p>
          <h2 id={headingId}>{item.title}</h2>
        </div>
        <Link href={item.href} className="review-card__record-link">
          Open record <span aria-hidden="true">↗</span>
        </Link>
      </header>

      <div className="review-card__body">
        <div className="review-card__reason">
          <span>Why now</span>
          <p>{item.whyNow || 'Robin needs a human judgment before continuing.'}</p>
        </div>
        {item.belief ? (
          <div className="review-card__reason">
            <span>Robin’s current read</span>
            <p>{item.belief}</p>
          </div>
        ) : null}
        {item.targetTitle ? (
          <p className="review-card__impact">
            This choice updates <strong>{item.targetTitle}</strong> with edit history.
          </p>
        ) : null}
      </div>

      <div className="review-card__actions" aria-label={`Actions for ${item.title}`}>
        {item.interventionKind === 'commitment-checkpoint' ? (
          <>
            <button
              ref={primaryButtonRef}
              type="button"
              className="r-btn r-btn--primary"
              disabled={busy}
              onClick={() => void onResolve(item, 'fulfilled')}
            >
              {busy ? 'Recording…' : 'Kept'}
            </button>
            <button
              type="button"
              className="r-btn"
              disabled={busy}
              onClick={() => void onResolve(item, 'missed')}
            >
              Missed
            </button>
            <button
              type="button"
              className="r-btn"
              disabled={busy}
              onClick={() => void onResolve(item, 'cancelled')}
            >
              Released
            </button>
          </>
        ) : item.interventionKind === 'conflict' ? (
          <>
            <button
              ref={primaryButtonRef}
              type="button"
              className="r-btn r-btn--primary"
              disabled={busy}
              onClick={() => void onResolve(item, 'proposed')}
            >
              {busy ? 'Applying…' : `Use ${item.proposedValue ?? 'meeting value'}`}
            </button>
            <button
              type="button"
              className="r-btn"
              disabled={busy}
              onClick={() => void onResolve(item, 'existing')}
            >
              Keep {item.existingValue ?? 'current'}
            </button>
          </>
        ) : (
          <button
            ref={primaryButtonRef}
            type="button"
            className="r-btn r-btn--primary"
            disabled={busy}
            onClick={() => void onResolve(item, 'confirmed')}
          >
            {busy ? 'Confirming…' : 'Confirm'}
          </button>
        )}

        {item.interventionKind !== 'commitment-checkpoint' ? (
          <button
            type="button"
            className="r-btn r-btn--ghost"
            disabled={busy}
            onClick={() => void onResolve(item, 'dismissed')}
          >
            Not relevant
          </button>
        ) : null}

        <span className="review-card__action-links">
          {item.commitmentHref ? <Link href={item.commitmentHref}>Open promise</Link> : null}
          {item.sourceHref ? <Link href={item.sourceHref}>Review evidence</Link> : null}
        </span>
      </div>

      {error ? (
        <p id={errorId} className="review-card__error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
