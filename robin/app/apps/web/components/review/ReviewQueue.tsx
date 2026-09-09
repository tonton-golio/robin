'use client';

import { useRouter } from 'next/navigation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefCallback,
} from 'react';
import {
  useActiveDocumentRegistration,
  type DocumentWriteState,
} from '@/components/shell/ActiveDocumentProvider';
import type { InterventionResolution } from '@/lib/interventions';
import {
  filterReviewItems,
  reviewCounts,
  type BeliefReviewItem,
  type CommentReviewItem,
  type DecisionReviewItem,
  type ReviewFilter,
  type ReviewItem,
  type ReviewSnapshot,
  type ReviewSource,
} from '@/lib/review/model';
import { ReviewCard } from './ReviewCard';

const FILTERS: Array<{ value: ReviewFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'decision', label: 'Decisions' },
  { value: 'belief', label: 'Beliefs' },
  { value: 'comment', label: 'Comments' },
];

const SOURCE_LABELS: Record<ReviewSource, string> = {
  intervention: 'Decisions',
  memory: 'Beliefs',
  annotation: 'Comments',
};

function localMemorySource(item: BeliefReviewItem): string {
  const source = item.sources.find(({ ref }) => /^(brain|inbox|logs|out)\//.test(ref));
  return source?.ref ?? 'brain/memory/events.jsonl';
}

function activeSourcePath(item: ReviewItem | undefined): string {
  if (!item) return 'Review · live';
  if (item.kind === 'decision') return item.path;
  if (item.kind === 'comment') {
    return item.renderPath ?? item.pagePath ?? 'Review · live';
  }
  return localMemorySource(item);
}

function mutationSourcePath(item: ReviewItem): string {
  if (item.kind === 'decision') return item.path;
  if (item.kind === 'belief') return 'brain/memory/events.jsonl';
  return `inbox/robin/annotations/${new Date().toISOString().slice(0, 7)}.jsonl`;
}

function resolvedLabel(item: ReviewItem): string {
  if (item.kind === 'decision') return 'Decision saved';
  if (item.kind === 'belief') return 'Belief reviewed';
  return 'Comment reviewed';
}

function remainingLabel(filter: ReviewFilter, count: number): string {
  const noun =
    filter === 'all'
      ? count === 1
        ? 'item'
        : 'items'
      : filter === 'decision'
        ? count === 1
          ? 'decision'
          : 'decisions'
        : filter === 'belief'
          ? count === 1
            ? 'belief'
            : 'beliefs'
          : count === 1
            ? 'comment'
            : 'comments';
  return `${count} ${noun} remain`;
}

export function ReviewQueue({ initialSnapshot }: { initialSnapshot: ReviewSnapshot }) {
  const router = useRouter();
  const [items, setItems] = useState(initialSnapshot.items);
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSnapshot.items[0]?.id ?? null,
  );
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState('');
  const [writeFeedback, setWriteFeedback] = useState<{
    path: string;
    state: DocumentWriteState;
  } | null>(null);
  const primaryButtons = useRef(new Map<string, HTMLButtonElement>());
  const emptyHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<string | 'empty' | null>(null);
  const pendingMutation = useRef<string | null>(null);
  const writeFeedbackTimer = useRef<number | null>(null);

  useEffect(() => {
    setItems(initialSnapshot.items);
  }, [initialSnapshot.items]);

  const counts = useMemo(() => reviewCounts(items), [items]);
  const visibleItems = useMemo(() => filterReviewItems(items, filter), [filter, items]);
  const selectedItem =
    visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0];

  useActiveDocumentRegistration({
    path: writeFeedback?.path ?? activeSourcePath(selectedItem),
    mode: 'view',
    writeState: writeFeedback?.state ?? { kind: 'read-only' },
    updatedAt: selectedItem?.updatedAt,
  });

  useEffect(
    () => () => {
      if (writeFeedbackTimer.current) window.clearTimeout(writeFeedbackTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (
      writeFeedback?.state.kind === 'error' &&
      selectedItem &&
      mutationSourcePath(selectedItem) !== writeFeedback.path
    ) {
      setWriteFeedback(null);
    }
  }, [selectedItem, writeFeedback]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const frame = requestAnimationFrame(() => {
      if (target === 'empty') {
        emptyHeadingRef.current?.focus();
      } else {
        primaryButtons.current.get(target)?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [items]);

  function registerPrimaryButton(id: string): RefCallback<HTMLButtonElement> {
    return (node) => {
      if (node) primaryButtons.current.set(id, node);
      else primaryButtons.current.delete(id);
    };
  }

  function removeAfterSuccess(item: ReviewItem) {
    const before = filterReviewItems(items, filter);
    const currentIndex = Math.max(0, before.findIndex((candidate) => candidate.id === item.id));
    const nextItems = items.filter((candidate) => candidate.id !== item.id);
    const after = filterReviewItems(nextItems, filter);
    const next = after[Math.min(currentIndex, Math.max(0, after.length - 1))];

    pendingFocus.current = next?.id ?? 'empty';
    setSelectedId(next?.id ?? null);
    setItems(nextItems);
    setAnnouncement(`${resolvedLabel(item)}. ${remainingLabel(filter, after.length)}.`);
  }

  async function commitMutation(
    item: ReviewItem,
    failureMessage: string,
    request: () => Promise<Response>,
  ): Promise<void> {
    if (pendingMutation.current) return;
    const writePath = mutationSourcePath(item);
    pendingMutation.current = item.id;
    setBusyId(item.id);
    setWriteFeedback({ path: writePath, state: { kind: 'saving' } });
    setCardErrors((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });

    try {
      const response = await request();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const savedAt = new Date().toISOString();
      setWriteFeedback({
        path: writePath,
        state: { kind: 'saved', at: savedAt },
      });
      if (writeFeedbackTimer.current) window.clearTimeout(writeFeedbackTimer.current);
      writeFeedbackTimer.current = window.setTimeout(() => {
        setWriteFeedback(null);
        writeFeedbackTimer.current = null;
      }, 1_400);
      removeAfterSuccess(item);
      window.dispatchEvent(new CustomEvent('robin:workspace-summary'));
      router.refresh();
    } catch {
      const message = `${failureMessage} Nothing changed. Try again.`;
      setCardErrors((current) => ({
        ...current,
        [item.id]: message,
      }));
      setWriteFeedback({
        path: writePath,
        state: { kind: 'error', message },
      });
    } finally {
      pendingMutation.current = null;
      setBusyId(null);
    }
  }

  function resolveDecision(
    item: DecisionReviewItem,
    resolution: InterventionResolution,
  ): Promise<void> {
    return commitMutation(
      item,
      'The decision record could not be updated.',
      () =>
        fetch('/api/intervention/resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: item.path, resolution }),
        }),
    );
  }

  function resolveBelief(
    item: BeliefReviewItem,
    status: 'active' | 'rejected',
    resolution: string,
  ): Promise<void> {
    return commitMutation(
      item,
      'The memory record could not be updated.',
      () =>
        fetch('/api/memory/resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: item.memoryId, status, resolution }),
        }),
    );
  }

  function resolveComment(
    item: CommentReviewItem,
    status: 'resolved' | 'rejected',
    resolution: string,
  ): Promise<void> {
    return commitMutation(
      item,
      'The annotation record could not be updated.',
      () =>
        fetch('/api/annotations', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: item.annotationId,
            status,
            page_path: item.pagePath,
            render_path: item.renderPath ?? item.pagePath,
            resolution_md: resolution,
          }),
        }),
    );
  }

  const sourceErrors = (
    Object.entries(initialSnapshot.sourceErrors) as Array<[ReviewSource, string]>
  ).filter((entry): entry is [ReviewSource, string] => Boolean(entry[1]));

  return (
    <main className="review-page">
      <p className="review-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <header className="review-hero">
        <p className="r-bar">Review queue</p>
        <div className="review-hero__title">
          <div>
            <h1>Review what needs your judgment</h1>
            <p>
              Decisions, tentative beliefs, and comments—together, with their source
              and consequence in view.
            </p>
          </div>
          <div className="review-hero__count" aria-label={`${counts.all} items awaiting review`}>
            <strong>{counts.all}</strong>
            <span>waiting</span>
          </div>
        </div>
      </header>

      {sourceErrors.length > 0 ? (
        <section className="review-source-errors" aria-label="Unavailable review sources">
          {sourceErrors.map(([source, message]) => (
            <div className="review-source-error" role="status" key={source}>
              <div>
                <strong>{SOURCE_LABELS[source]}</strong>
                <span>{message} Other review items are still available.</span>
              </div>
              <button type="button" className="r-btn r-btn--ghost" onClick={() => router.refresh()}>
                Retry
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <div className="review-toolbar">
        <div className="review-filters" role="group" aria-label="Filter review queue">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              aria-controls="review-results"
              onClick={() => {
                setFilter(value);
                setSelectedId(null);
              }}
            >
              <span>{label}</span>
              <span className="review-filter__count">{counts[value]}</span>
            </button>
          ))}
        </div>
        <p className="review-toolbar__summary">{remainingLabel(filter, visibleItems.length)}</p>
      </div>

      <section id="review-results" className="review-results" aria-label="Review items">
        {visibleItems.length > 0 ? (
          <ol className="review-list">
            {visibleItems.map((item) => (
              <li
                key={item.id}
                onFocusCapture={() => setSelectedId(item.id)}
                onPointerDown={() => setSelectedId(item.id)}
              >
                <ReviewCard
                  item={item}
                  busy={busyId === item.id}
                  error={cardErrors[item.id]}
                  primaryButtonRef={registerPrimaryButton(item.id)}
                  onResolveDecision={resolveDecision}
                  onResolveBelief={resolveBelief}
                  onResolveComment={resolveComment}
                />
              </li>
            ))}
          </ol>
        ) : (
          <div className="review-empty">
            <p className="review-empty__mark" aria-hidden="true">✓</p>
            <h2 ref={emptyHeadingRef} tabIndex={-1}>
              {items.length === 0 ? 'Review is clear' : `No ${filter}s waiting`}
            </h2>
            <p>
              {items.length === 0
                ? 'Nothing needs your judgment right now.'
                : 'Choose another filter to continue reviewing.'}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
