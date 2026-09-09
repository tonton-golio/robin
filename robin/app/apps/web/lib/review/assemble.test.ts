import { describe, expect, it } from 'vitest';
import type { AnnotationRecord } from '@/lib/annotations';
import { assembleReviewSnapshot } from './assemble';

describe('assembleReviewSnapshot', () => {
  it('keeps healthy sources visible when another source fails', async () => {
    const annotation: AnnotationRecord = {
      id: 'ann_attention',
      status: 'needs-attention',
      created_at: '2026-07-27T09:00:00.000Z',
      page_path: 'brain/projects/launch.html',
      render_path: 'brain/projects/launch.html',
      comment_md: 'Please verify this.',
    };

    const snapshot = await assembleReviewSnapshot({
      loadInterventions: async () => {
        throw new Error('vault read failed');
      },
      loadMemories: async () => [],
      loadAnnotations: async () => [annotation],
    });

    expect(snapshot.items.map((item) => item.id)).toEqual(['comment:ann_attention']);
    expect(snapshot.counts).toEqual({
      all: 1,
      decision: 0,
      belief: 0,
      comment: 1,
    });
    expect(snapshot.sourceErrors).toEqual({
      intervention: 'Decision records are unavailable right now.',
    });
  });
});
