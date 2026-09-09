import type { MemoryRecord } from '@robin/memory';
import type { AnnotationRecord } from '@/lib/annotations';
import type { InterventionItem } from '@/lib/interventions';
import {
  reviewCounts,
  reviewItemsFromAnnotations,
  reviewItemsFromInterventions,
  reviewItemsFromMemories,
  sortReviewItems,
  type ReviewSnapshot,
  type ReviewSource,
} from './model';

export interface ReviewLoaders {
  loadInterventions: () => Promise<InterventionItem[]>;
  loadMemories: () => Promise<MemoryRecord[]>;
  loadAnnotations: () => Promise<AnnotationRecord[]>;
}

const SOURCE_ERROR: Record<ReviewSource, string> = {
  intervention: 'Decision records are unavailable right now.',
  memory: 'Tentative beliefs are unavailable right now.',
  annotation: 'Comments needing attention are unavailable right now.',
};

export async function assembleReviewSnapshot(
  loaders: ReviewLoaders,
): Promise<ReviewSnapshot> {
  const [interventions, memories, annotations] = await Promise.allSettled([
    loaders.loadInterventions(),
    loaders.loadMemories(),
    loaders.loadAnnotations(),
  ]);

  const sourceErrors: ReviewSnapshot['sourceErrors'] = {};
  if (interventions.status === 'rejected') {
    sourceErrors.intervention = SOURCE_ERROR.intervention;
  }
  if (memories.status === 'rejected') {
    sourceErrors.memory = SOURCE_ERROR.memory;
  }
  if (annotations.status === 'rejected') {
    sourceErrors.annotation = SOURCE_ERROR.annotation;
  }

  const items = sortReviewItems([
    ...(interventions.status === 'fulfilled'
      ? reviewItemsFromInterventions(interventions.value)
      : []),
    ...(memories.status === 'fulfilled' ? reviewItemsFromMemories(memories.value) : []),
    ...(annotations.status === 'fulfilled'
      ? reviewItemsFromAnnotations(annotations.value)
      : []),
  ]);

  return {
    items,
    counts: reviewCounts(items),
    sourceErrors,
  };
}
