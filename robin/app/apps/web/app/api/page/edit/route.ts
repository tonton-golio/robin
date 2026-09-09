/**
 * GET /api/page/edit?path=brain/foo.html
 *
 * Returns the page's canonical content as RobinBlock[] plus an `editable` flag,
 * for the inline editor's load path. See lib/page-edit.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPageForEdit } from '@/lib/page-edit';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'missing path' }, { status: 400 });
  }
  const result = await getPageForEdit(path);
  if ('error' in result) {
    return NextResponse.json(result, { status: result.error === 'not_found' ? 404 : 400 });
  }
  return NextResponse.json(result);
}
