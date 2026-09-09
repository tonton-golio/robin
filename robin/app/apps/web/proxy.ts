import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { guardApiRequest } from '@/lib/api-request-guard';

/**
 * Next.js 16 request proxy (formerly middleware).
 *
 * Guard all dynamic routes, not only `/api`: server-rendered pages read the
 * same private vault, and remote authentication would be incomplete if HTML
 * documents remained public while only their follow-up API calls were gated.
 */
export function proxy(request: NextRequest): NextResponse {
  return guardApiRequest(request) ?? NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
