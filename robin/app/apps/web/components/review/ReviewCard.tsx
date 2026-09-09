'use client';

import type { RefCallback } from 'react';
import type { InterventionResolution } from '@/lib/interventions';
import type {
  BeliefReviewItem,
  CommentReviewItem,
  DecisionReviewItem,
  ReviewItem,
} from '@/lib/review';
import { BeliefReviewCard } from './BeliefReviewCard';
import { CommentReviewCard } from './CommentReviewCard';
import { DecisionReviewCard } from './DecisionReviewCard';

export interface ReviewCardProps {
  item: ReviewItem;
  busy: boolean;
  error?: string;
  primaryButtonRef: RefCallback<HTMLButtonElement>;
  onResolveDecision: (
    item: DecisionReviewItem,
    resolution: InterventionResolution,
  ) => Promise<void>;
  onResolveBelief: (
    item: BeliefReviewItem,
    status: 'active' | 'rejected',
    resolution: string,
  ) => Promise<void>;
  onResolveComment: (
    item: CommentReviewItem,
    status: 'resolved' | 'rejected',
    resolution: string,
  ) => Promise<void>;
}

export function ReviewCard(props: ReviewCardProps) {
  if (props.item.kind === 'decision') {
    return (
      <DecisionReviewCard
        item={props.item}
        busy={props.busy}
        error={props.error}
        primaryButtonRef={props.primaryButtonRef}
        onResolve={props.onResolveDecision}
      />
    );
  }

  if (props.item.kind === 'belief') {
    return (
      <BeliefReviewCard
        item={props.item}
        busy={props.busy}
        error={props.error}
        primaryButtonRef={props.primaryButtonRef}
        onResolve={props.onResolveBelief}
      />
    );
  }

  return (
    <CommentReviewCard
      item={props.item}
      busy={props.busy}
      error={props.error}
      primaryButtonRef={props.primaryButtonRef}
      onResolve={props.onResolveComment}
    />
  );
}
