import { NextResponse } from 'next/server';
import { loadInbox } from '@/lib/inbox/load';
import { loadReviewSnapshot } from '@/lib/review/load';

export const dynamic = 'force-dynamic';

/**
 * Small, failure-isolated badge contract for the persistent shell.
 *
 * A broken Review source must not hide Inbox's count (and vice versa), so each
 * loader settles independently. Destinations remain usable when a count is
 * degraded; the shell simply omits the unavailable number.
 */
export async function GET() {
  const [inboxResult, reviewResult] = await Promise.allSettled([
    loadInbox(),
    loadReviewSnapshot(),
  ]);

  const degraded: string[] = [];
  let inbox = 0;
  let review = 0;

  if (inboxResult.status === 'fulfilled') {
    inbox = inboxResult.value.stats.pending + inboxResult.value.stats.recovery;
    if (inboxResult.value.error) degraded.push('inbox');
  } else {
    degraded.push('inbox');
  }

  if (reviewResult.status === 'fulfilled') {
    review = reviewResult.value.counts.all;
    if (Object.keys(reviewResult.value.sourceErrors).length > 0) {
      degraded.push('review');
    }
  } else {
    degraded.push('review');
  }

  return NextResponse.json(
    {
      inbox,
      review,
      ...(degraded.length > 0 ? { degraded } : {}),
    },
    {
      headers: {
        'cache-control': 'no-store',
      },
    },
  );
}
