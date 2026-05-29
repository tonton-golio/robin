import { describe, expect, it } from 'vitest';
import {
  collapseAnnotationEvents,
  DEFAULT_ANNOTATION_COLOR,
  normalizeAnnotationAnchor,
  normalizeAnnotationPin,
  normalizeLearnCategory,
  isClosedAnnotationStatus,
  type AnnotationEvent,
} from './annotations';

describe('annotation event projection', () => {
  it('uses a resolution event without page metadata to close the original annotation', () => {
    const events: AnnotationEvent[] = [
      {
        id: 'ann_1',
        event: 'annotation.created',
        status: 'open',
        created_at: '2026-05-29T09:00:00Z',
        page_path: 'out/example.html',
        render_path: 'out/example.html',
        comment_md: 'Fix this',
      },
      {
        id: 'ann_1',
        event: 'annotation.resolved',
        status: 'resolved',
        resolved_at: '2026-05-29T10:00:00Z',
        resolution_md: 'Fixed',
      },
    ];

    const [annotation] = collapseAnnotationEvents(events);
    expect(annotation?.status).toBe('resolved');
    expect(annotation?.page_path).toBe('out/example.html');
    expect(annotation?.resolution_md).toBe('Fixed');
    expect(isClosedAnnotationStatus(annotation?.status ?? '')).toBe(true);
  });

  it('keeps needs-attention annotations open', () => {
    const [annotation] = collapseAnnotationEvents<AnnotationEvent>([
      {
        id: 'ann_2',
        event: 'annotation.created',
        status: 'open',
        created_at: '2026-05-29T09:00:00Z',
      },
      {
        id: 'ann_2',
        event: 'annotation.needs-attention',
        status: 'needs-attention',
        updated_at: '2026-05-29T10:00:00Z',
      },
    ]);

    expect(annotation?.status).toBe('needs-attention');
    expect(isClosedAnnotationStatus(annotation?.status ?? '')).toBe(false);
  });
});

describe('annotation input normalization', () => {
  it('uses amber as the single creation color', () => {
    expect(DEFAULT_ANNOTATION_COLOR).toBe('amber');
  });

  it('normalizes finite slide pins and rejects non-finite coordinates', () => {
    expect(normalizeAnnotationPin({ slide: 2.8, x: 1.4, y: -0.2 })).toEqual({
      slide: 2,
      x: 1,
      y: 0,
    });
    expect(normalizeAnnotationPin({ slide: 1, x: Number.NaN, y: 0.5 })).toBeUndefined();
    expect(normalizeAnnotationPin({ slide: Infinity, x: 0.5, y: 0.5 })).toBeUndefined();
  });

  it('normalizes anchors and rejects non-finite text positions', () => {
    const anchor = normalizeAnnotationAnchor({
      block_path: [2, 1.5, 3, 'x'],
      text_quote: {
        exact: 'selected text',
        prefix: 'before',
        suffix: 'after',
      },
      text_position: {
        start: 20.9,
        end: 5.1,
      },
    });

    expect(anchor).toMatchObject({
      block_path: [2, 3],
      text_position: {
        start: 5,
        end: 20,
      },
    });
    expect(normalizeAnnotationAnchor({
      text_quote: { exact: 'x', prefix: '', suffix: '' },
      text_position: { start: Number.NaN, end: 2 },
    })).toBeNull();
  });

  it('falls back unknown learn categories to other', () => {
    expect(normalizeLearnCategory('preference')).toBe('preference');
    expect(normalizeLearnCategory('surprise')).toBe('other');
  });
});
