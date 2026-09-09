import { timingSafeEqual } from 'node:crypto';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MIN_REMOTE_TOKEN_LENGTH = 32;

export type SecurityEnv = Readonly<Record<string, string | undefined>>;

export type RuntimeSecurityConfig =
  | { mode: 'local' }
  | {
      mode: 'authenticated';
      token: string;
      publicOrigin: string;
      publicHost: string;
    }
  | { mode: 'invalid'; reason: string };

export interface RuntimeRequestInput {
  host?: string | null;
  origin?: string | null;
  authorization?: string | null;
  secFetchSite?: string | null;
  secFetchMode?: string | null;
  secFetchDest?: string | null;
  method?: string | null;
}

export type RuntimeRequestVerdict =
  | { ok: true; mode: 'local' | 'authenticated' }
  | {
      ok: false;
      status: 401 | 403 | 503;
      reason:
        | 'invalid_security_config'
        | 'host_not_allowed'
        | 'origin_not_allowed'
        | 'cross_site_request'
        | 'authentication_required';
    };

export type VoiceRelayBindConfig =
  | { ok: true; host: string; mode: 'local' | 'authenticated' }
  | { ok: false; reason: string };

function normalizeHostname(hostname: string): string {
  const lowered = hostname.trim().toLowerCase();
  const unbracketed = lowered.startsWith('[') && lowered.endsWith(']')
    ? lowered.slice(1, -1)
    : lowered;
  return unbracketed.endsWith('.') ? unbracketed.slice(0, -1) : unbracketed;
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(normalizeHostname(hostname));
}

function parseHostHeader(raw: string | null | undefined): { host: string; hostname: string } | null {
  const value = raw?.trim();
  if (!value || /[\s,/\\]/.test(value)) return null;

  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/') return null;
    return {
      host: parsed.host.toLowerCase(),
      hostname: normalizeHostname(parsed.hostname),
    };
  } catch {
    return null;
  }
}

function parsePublicOrigin(raw: string | undefined): { origin: string; host: string } | null {
  const value = raw?.trim().replace(/\/$/, '');
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }
    return { origin: parsed.origin, host: parsed.host.toLowerCase() };
  } catch {
    return null;
  }
}

export function getRuntimeSecurityConfig(
  env: SecurityEnv = process.env,
): RuntimeSecurityConfig {
  const rawMode = env['ROBIN_REMOTE_ACCESS']?.trim().toLowerCase() ?? '';
  if (!rawMode || rawMode === 'local') return { mode: 'local' };
  if (rawMode !== 'authenticated') {
    return { mode: 'invalid', reason: 'ROBIN_REMOTE_ACCESS must be local or authenticated' };
  }

  const token = env['ROBIN_API_TOKEN']?.trim() ?? '';
  if (token.length < MIN_REMOTE_TOKEN_LENGTH) {
    return {
      mode: 'invalid',
      reason: `ROBIN_API_TOKEN must contain at least ${MIN_REMOTE_TOKEN_LENGTH} characters`,
    };
  }

  const publicOrigin = parsePublicOrigin(env['ROBIN_PUBLIC_ORIGIN']);
  if (!publicOrigin) {
    return {
      mode: 'invalid',
      reason: 'ROBIN_PUBLIC_ORIGIN must be one exact http(s) origin with no path',
    };
  }

  return {
    mode: 'authenticated',
    token,
    publicOrigin: publicOrigin.origin,
    publicHost: publicOrigin.host,
  };
}

function tokenMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorizationMatches(raw: string | null | undefined, expectedToken: string): boolean {
  const value = raw?.trim();
  if (!value) return false;

  const bearer = /^Bearer\s+(.+)$/i.exec(value);
  if (bearer?.[1]) return tokenMatches(bearer[1].trim(), expectedToken);

  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!basic?.[1]) return false;
  try {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0 || decoded.slice(0, separator) !== 'robin') return false;
    return tokenMatches(decoded.slice(separator + 1), expectedToken);
  } catch {
    return false;
  }
}

function originIsLoopback(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function isCrossSiteFetch(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && normalized !== 'same-origin' && normalized !== 'none');
}

/**
 * A top-level document GET/HEAD is the user typing a URL or following a link.
 * The browser's same-origin policy stops the referring site from reading the
 * response, so this is not the CSRF shape the cross-site check exists to stop —
 * and rejecting it serves a raw JSON error instead of the app. Anything else
 * cross-site (fetch/XHR, subresources, unsafe methods) stays blocked.
 */
function isSafeTopLevelNavigation(input: RuntimeRequestInput): boolean {
  const mode = input.secFetchMode?.trim().toLowerCase();
  const dest = input.secFetchDest?.trim().toLowerCase();
  if (mode !== 'navigate' || dest !== 'document') return false;

  const method = input.method?.trim().toUpperCase();
  return !method || method === 'GET' || method === 'HEAD';
}

function isBlockedCrossSiteRequest(input: RuntimeRequestInput): boolean {
  return isCrossSiteFetch(input.secFetchSite) && !isSafeTopLevelNavigation(input);
}

export function authorizeRuntimeRequest(
  input: RuntimeRequestInput,
  env: SecurityEnv = process.env,
): RuntimeRequestVerdict {
  const config = getRuntimeSecurityConfig(env);
  if (config.mode === 'invalid') {
    return { ok: false, status: 503, reason: 'invalid_security_config' };
  }

  const host = parseHostHeader(input.host);
  if (!host) return { ok: false, status: 403, reason: 'host_not_allowed' };

  if (config.mode === 'local') {
    if (!isLoopbackHostname(host.hostname)) {
      return { ok: false, status: 403, reason: 'host_not_allowed' };
    }
    if (input.origin && !originIsLoopback(input.origin)) {
      return { ok: false, status: 403, reason: 'origin_not_allowed' };
    }
    if (isBlockedCrossSiteRequest(input)) {
      return { ok: false, status: 403, reason: 'cross_site_request' };
    }
    return { ok: true, mode: 'local' };
  }

  if (host.host !== config.publicHost) {
    return { ok: false, status: 403, reason: 'host_not_allowed' };
  }
  if (input.origin && input.origin.replace(/\/$/, '') !== config.publicOrigin) {
    return { ok: false, status: 403, reason: 'origin_not_allowed' };
  }
  if (isBlockedCrossSiteRequest(input)) {
    return { ok: false, status: 403, reason: 'cross_site_request' };
  }
  if (!authorizationMatches(input.authorization, config.token)) {
    return { ok: false, status: 401, reason: 'authentication_required' };
  }

  return { ok: true, mode: 'authenticated' };
}

function normalizeBindHost(raw: string | undefined): string | null {
  const value = raw?.trim() || '127.0.0.1';
  const unbracketed = value.startsWith('[') && value.endsWith(']')
    ? value.slice(1, -1)
    : value;
  return /^[A-Za-z0-9._:-]+$/.test(unbracketed) ? unbracketed : null;
}

export function getVoiceRelayBindConfig(
  env: SecurityEnv = process.env,
): VoiceRelayBindConfig {
  const security = getRuntimeSecurityConfig(env);
  if (security.mode === 'invalid') {
    return { ok: false, reason: security.reason };
  }

  const host = normalizeBindHost(env['INTERVIEW_WS_HOST']);
  if (!host) return { ok: false, reason: 'INTERVIEW_WS_HOST is invalid' };
  if (!isLoopbackHostname(host) && security.mode !== 'authenticated') {
    return {
      ok: false,
      reason: 'a non-loopback INTERVIEW_WS_HOST requires authenticated remote access',
    };
  }

  return { ok: true, host, mode: security.mode };
}

export function configuredRemoteOrigin(env: SecurityEnv = process.env): string | null {
  const config = getRuntimeSecurityConfig(env);
  return config.mode === 'authenticated' ? config.publicOrigin : null;
}
