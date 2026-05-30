import { NextRequest, NextResponse } from 'next/server';
import { getMaintenanceSnapshot } from '@/lib/maintenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
  const snapshot = await getMaintenanceSnapshot({ limit });

  return NextResponse.json(snapshot);
}
