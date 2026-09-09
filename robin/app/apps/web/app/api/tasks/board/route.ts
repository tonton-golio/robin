/**
 * GET /api/tasks/board
 *
 * Returns the full task list as JSON — the SWR key the Standup board mutates and
 * revalidates after an optimistic edit. Reads fresh from disk (force-dynamic) so
 * a board write is reflected on the next revalidation without a reindex.
 */

import { NextResponse } from 'next/server';
import { listTasks } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const tasks = await listTasks();
    return NextResponse.json({ tasks });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to list tasks' },
      { status: 500 },
    );
  }
}
