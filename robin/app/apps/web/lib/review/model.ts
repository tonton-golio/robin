import type {
  MemoryConfidence,
  MemoryRecord,
  MemorySource,
  MemoryTier,
  MemoryType,
} from '@robin/memory';
import type { AnnotationRecord } from '@/lib/annotations';
import { annotationEventTimestamp } from '@/lib/annotations';
import type { InterventionItem } from '@/lib/interventions';
import { vaultPageHref } from '@/lib/routes';

export type ReviewKind = 'decision' | 'belief' | 'comment';
export type ReviewFilter = 'all' | ReviewKind;
export type ReviewSource = 'intervention' | 'memory' | 'annotation';

interface ReviewItemBase {
  id: string;
  kind: ReviewKind;
  source: ReviewSource;
  title: string;
  updatedAt: string;
}

export interface DecisionReviewItem extends ReviewItemBase {
  kind: 'decision';
  source: 'intervention';
  path: string;
  href: string;
  interventionKind: InterventionItem['kind'];
  whyNow: string;
  belief: string;
  evidenceState: string;
  recommendedAction: string;
  existingValue?: string;
  proposedValue?: string;
  targetTitle?: string;
  commitmentHref?: string;
  sourceHref?: string;
}

export interface BeliefReviewSource {
  kind: MemorySource['kind'];
  ref: string;
  quote?: string;
  capturedAt?: string;
}

export interface BeliefReviewItem extends ReviewItemBase {
  kind: 'belief';
  source: 'memory';
  memoryId: string;
  memoryType: MemoryType;
  tier: MemoryTier;
  confidence: MemoryConfidence;
  scope: string;
  subject: string;
  summary: string;
  body?: string;
  tags: string[];
  sources: BeliefReviewSource[];
  sourceCount: number;
  seenCount: number;
}

export interface CommentReviewItem extends ReviewItemBase {
  kind: 'comment';
  source: 'annotation';
  annotationId: string;
  status: 'needs-attention';
  pagePath?: string;
  renderPath?: string;
  pageHref?: string;
  comment: string;
  quote?: string;
  author?: string;
  pageChanged: boolean;
}

export type ReviewItem = DecisionReviewItem | BeliefReviewItem | CommentReviewItem;

export type ReviewCounts = Record<ReviewFilter, number>;

export interface ReviewSnapshot {
  items: ReviewItem[];
  counts: ReviewCounts;
  sourceErrors: Partial<Record<ReviewSource, string>>;
}

const KIND_RANK: Record<ReviewKind, number> = {
  decision: 0,
  belief: 1,
  comment: 2,
};

function pageLabel(pathValue: string | undefined): string {
  const leaf = pathValue?.split('/').at(-1)?.replace(/\.html$/i, '') ?? '';
  const label = leaf.replace(/[-_]+/g, ' ').trim();
  return label || 'page';
}

function annotationPageHref(pagePath: string | undefined): string | undefined {
  return pagePath && /\.html$/i.test(pagePath) ? vaultPageHref(pagePath) : undefined;
}

export function reviewItemsFromInterventions(
  interventions: InterventionItem[],
): DecisionReviewItem[] {
  return interventions.map((item) => ({
    id: `decision:${item.path}`,
    kind: 'decision',
    source: 'intervention',
    title: item.title,
    updatedAt: item.updated,
    path: item.path,
    href: item.href,
    interventionKind: item.kind,
    whyNow: item.whyNow,
    belief: item.belief,
    evidenceState: item.evidenceState,
    recommendedAction: item.recommendedAction,
    existingValue: item.existingValue,
    proposedValue: item.proposedValue,
    targetTitle: item.targetTitle,
    commitmentHref: item.commitmentHref,
    sourceHref: item.sourceHref,
  }));
}

export function reviewItemsFromMemories(memories: MemoryRecord[]): BeliefReviewItem[] {
  return memories
    .filter((memory) => memory.status === 'tentative')
    .map((memory) => ({
      id: `belief:${memory.id}`,
      kind: 'belief',
      source: 'memory',
      title: memory.subject,
      updatedAt: memory.updated_at,
      memoryId: memory.id,
      memoryType: memory.type,
      tier: memory.tier,
      confidence: memory.confidence,
      scope: memory.scope,
      subject: memory.subject,
      summary: memory.summary,
      body: memory.body,
      tags: memory.tags,
      sources: memory.sources.map((source) => ({
        kind: source.kind,
        ref: source.ref,
        quote: source.quote,
        capturedAt: source.captured_at,
      })),
      sourceCount: memory.source_count,
      seenCount: memory.seen_count,
    }));
}

export function reviewItemsFromAnnotations(
  annotations: AnnotationRecord[],
): CommentReviewItem[] {
  return annotations
    .filter((annotation) => annotation.status === 'needs-attention')
    .map((annotation) => {
      const pagePath = annotation.page_path ?? annotation.render_path;
      return {
        id: `comment:${annotation.id}`,
        kind: 'comment',
        source: 'annotation',
        title: `Comment on ${pageLabel(pagePath)}`,
        updatedAt: annotationEventTimestamp(annotation),
        annotationId: annotation.id,
        status: 'needs-attention',
        pagePath: annotation.page_path,
        renderPath: annotation.render_path,
        pageHref: annotationPageHref(pagePath),
        comment: annotation.comment_md?.trim() ?? '',
        quote: annotation.anchor?.text_quote.exact.trim() || undefined,
        author: annotation.author?.trim() || undefined,
        pageChanged: annotation.pageChanged === true,
      };
    });
}

export function sortReviewItems(items: ReviewItem[]): ReviewItem[] {
  return [...items].sort((a, b) => {
    const kindDifference = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    return (
      kindDifference ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id)
    );
  });
}

export function reviewCounts(items: ReviewItem[]): ReviewCounts {
  return {
    all: items.length,
    decision: items.filter((item) => item.kind === 'decision').length,
    belief: items.filter((item) => item.kind === 'belief').length,
    comment: items.filter((item) => item.kind === 'comment').length,
  };
}

export function filterReviewItems(
  items: ReviewItem[],
  filter: ReviewFilter,
): ReviewItem[] {
  return filter === 'all' ? items : items.filter((item) => item.kind === filter);
}
