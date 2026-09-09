import type { Metadata } from 'next';
import { ReviewQueue } from '@/components/review/ReviewQueue';
import { loadReviewSnapshot } from '@/lib/review/load';
import '@/styles/page-review.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Review · Robin',
  description: 'One queue for decisions, tentative beliefs, and comments needing attention.',
};

export default async function ReviewPage() {
  const snapshot = await loadReviewSnapshot();
  return <ReviewQueue initialSnapshot={snapshot} />;
}
