import { NextResponse } from 'next/server';
import { authorizeRuntimeRequest, type SecurityEnv } from './runtime-security';

/**
 * Central request boundary for Robin's dynamic web/API surface.
 *
 * Local mode accepts only loopback Host/Origin values. Authenticated remote
 * mode additionally requires the configured public Host/Origin and either
 * `Authorization: Bearer <ROBIN_API_TOKEN>` or HTTP Basic credentials using
 * username `robin` and the token as password.
 */
export function guardApiRequest(
  request: Request,
  env: SecurityEnv = process.env,
): NextResponse | null {
  let fallbackHost: string | null = null;
  try {
    fallbackHost = new URL(request.url).host;
  } catch {
    // The verdict below rejects a missing/invalid Host.
  }

  const verdict = authorizeRuntimeRequest({
    host: request.headers.get('host') ?? fallbackHost,
    origin: request.headers.get('origin'),
    authorization: request.headers.get('authorization'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    secFetchMode: request.headers.get('sec-fetch-mode'),
    secFetchDest: request.headers.get('sec-fetch-dest'),
    method: request.method,
  }, env);

  if (verdict.ok) return null;

  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    vary: 'Authorization, Host, Origin',
  };
  if (verdict.status === 401) {
    headers['www-authenticate'] = 'Basic realm="Robin", charset="UTF-8"';
  }

  const error = verdict.status === 503
    ? 'security_configuration_invalid'
    : verdict.status === 401
      ? 'authentication_required'
      : 'request_origin_forbidden';

  return NextResponse.json({ error }, { status: verdict.status, headers });
}
