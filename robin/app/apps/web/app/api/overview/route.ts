import { NextResponse } from 'next/server';
import { loadOverview } from '@/lib/overview';

export const dynamic = 'force-dynamic';

/** Local canonical context for both Day and agents. GET never writes to the vault. */
export async function GET() {
  return NextResponse.json(await loadOverview(), { headers: { 'Cache-Control': 'no-store' } });
}
