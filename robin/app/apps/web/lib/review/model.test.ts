import type { MemoryRecord } from '@robin/memory';
import { describe, expect, it } from 'vitest';
import type { AnnotationRecord } from '@/lib/annotations';
import type { InterventionItem } from '@/lib/interventions';
import {
  filterReviewItems,
  reviewCounts,
  reviewItemsFromAnnotations,
  reviewItemsFromInterventions,
  reviewItemsFromMemories,
  sortReviewItems,
} from './model';

function intervention(overrides: Partial<InterventionItem> = {}): InterventionItem {
  return {
    path: 'brain/interventions/decision.html',
    href: '/brain/interventions/decision',
    title: 'Choose the launch date',
    kind: 'conflict',
    whyNow: 'Two dates were recorded.',
    belief: 'The meeting date is newer.',
    evidenceState: 'conflicting',
    recommendedAction: 'Use the meeting value',
    existingValue: 'Monday',
    proposedValue: 'Tuesday',
    targetTitle: 'Launch plan',
    commitmentHref: '/brain/commitments/launch',
    sourceHref: '/brain/meetings/planning',
    updated: '2026-07-27T11:00:00.000Z',
    ...overrides,
  };
}

function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'mem_launch',
    type: 'preference',
    tier: 'semantic',
    status: 'tentative',
    confidence: 'medium',
    scope: 'work',
    subject: 'Launch reviews',
    summary: 'Prefers launch reviews on Tuesdays.',
    tags: ['launch'],
    links: [],
    sources: [
      {
        kind: 'meeting',
        ref: 'brain/meetings/planning.html',
        quote: 'Tuesday works best.',
      },
    ],
    source_count: 1,
    seen_count: 2,
    supersedes: [],
    created_at: '2026-07-26T09:00:00.000Z',
    updated_at: '2026-07-27T10:00:00.000Z',
    last_seen_at: '2026-07-27T10:00:00.000Z',
    fingerprint: 'launch-reviews',
    ...overrides,
  };
}

function annotation(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
  return {
    id: 'ann_launch',
    status: 'needs-attention',
    created_at: '2026-07-27T09:00:00.000Z',
    author: 'Alex',
    page_path: 'brain/projects/launch-plan.html',
    render_path: 'brain/projects/launch-plan.html',
    comment_md: 'This date needs a decision.',
    anchor: {
      block_path: [0],
      text_quote: { exact: 'Launch on Monday', prefix: '', suffix: '' },
      text_position: { start: 0, end: 16 },
    },
    ...overrides,
  };
}

describe('review model', () => {
  it('preserves the exact intervention fields needed by decision actions', () => {
    const [item] = reviewItemsFromInterventions([intervention()]);

    expect(item).toMatchObject({
      id: 'decision:brain/interventions/decision.html',
      kind: 'decision',
      interventionKind: 'conflict',
      existingValue: 'Monday',
      proposedValue: 'Tuesday',
      commitmentHref: '/brain/commitments/launch',
      sourceHref: '/brain/meetings/planning',
    });
  });

  it('admits only tentative memories and maps their provenance', () => {
    const items = reviewItemsFromMemories([
      memory(),
      memory({ id: 'mem_active', status: 'active' }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'belief:mem_launch',
      confidence: 'medium',
      sourceCount: 1,
      sources: [
        {
          kind: 'meeting',
          ref: 'brain/meetings/planning.html',
          quote: 'Tuesday works best.',
        },
      ],
    });
  });

  it('admits only needs-attention annotations and links HTML pages safely', () => {
    const items = reviewItemsFromAnnotations([
      annotation(),
      annotation({ id: 'ann_open', status: 'open' }),
      annotation({
        id: 'ann_pdf',
        page_path: 'out/deck.pdf',
        render_path: 'out/deck.pdf',
      }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'comment:ann_launch',
      title: 'Comment on launch plan',
      pageHref: '/brain/projects/launch-plan',
      quote: 'Launch on Monday',
    });
    expect(items[1]?.pageHref).toBeUndefined();
  });

  it('sorts by review priority then recency and supports every filter count', () => {
    const decision = reviewItemsFromInterventions([intervention()])[0]!;
    const belief = reviewItemsFromMemories([memory()])[0]!;
    const olderComment = reviewItemsFromAnnotations([annotation()])[0]!;
    const newerComment = reviewItemsFromAnnotations([
      annotation({
        id: 'ann_new',
        updated_at: '2026-07-27T12:00:00.000Z',
      }),
    ])[0]!;
    const sorted = sortReviewItems([olderComment, belief, newerComment, decision]);

    expect(sorted.map((item) => item.id)).toEqual([
      decision.id,
      belief.id,
      newerComment.id,
      olderComment.id,
    ]);
    expect(reviewCounts(sorted)).toEqual({
      all: 4,
      decision: 1,
      belief: 1,
      comment: 2,
    });
    expect(filterReviewItems(sorted, 'comment').map((item) => item.id)).toEqual([
      newerComment.id,
      olderComment.id,
    ]);
  });
});
