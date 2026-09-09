import { describe, expect, it } from 'vitest';
import {
  authorizeRuntimeRequest,
  getRuntimeSecurityConfig,
  getVoiceRelayBindConfig,
  type SecurityEnv,
} from './runtime-security';
import { guardApiRequest } from './api-request-guard';

const REMOTE_TOKEN = 'test-token-with-at-least-thirty-two-characters';

function remoteEnv(overrides: SecurityEnv = {}): SecurityEnv {
  return {
    ROBIN_REMOTE_ACCESS: 'authenticated',
    ROBIN_API_TOKEN: REMOTE_TOKEN,
    ROBIN_PUBLIC_ORIGIN: 'https://robin.example.com',
    ...overrides,
  };
}

describe('runtime request security', () => {
  it('allows loopback Host/Origin values in the default local mode', () => {
    expect(authorizeRuntimeRequest({
      host: 'localhost:8400',
      origin: 'http://127.0.0.1:8400',
      secFetchSite: 'same-origin',
    }, {})).toEqual({ ok: true, mode: 'local' });

    expect(authorizeRuntimeRequest({
      host: '[::1]:8400',
      origin: 'http://[::1]:8400',
    }, {})).toEqual({ ok: true, mode: 'local' });
  });

  it('rejects a non-loopback Host, Origin, or cross-site browser request by default', () => {
    expect(authorizeRuntimeRequest({ host: '192.168.1.20:8400' }, {})).toMatchObject({
      ok: false,
      reason: 'host_not_allowed',
    });
    expect(authorizeRuntimeRequest({
      host: 'localhost:8400',
      origin: 'https://attacker.example',
    }, {})).toMatchObject({ ok: false, reason: 'origin_not_allowed' });
    expect(authorizeRuntimeRequest({
      host: 'localhost:8400',
      secFetchSite: 'cross-site',
    }, {})).toMatchObject({ ok: false, reason: 'cross_site_request' });
  });

  it('allows a cross-site top-level document navigation but nothing else cross-site', () => {
    const navigation = {
      host: 'localhost:8400',
      secFetchSite: 'cross-site',
      secFetchMode: 'navigate',
      secFetchDest: 'document',
      method: 'GET',
    };
    expect(authorizeRuntimeRequest(navigation, {})).toEqual({ ok: true, mode: 'local' });
    expect(authorizeRuntimeRequest({ ...navigation, method: 'HEAD' }, {})).toEqual({
      ok: true,
      mode: 'local',
    });
    expect(authorizeRuntimeRequest({ ...navigation, secFetchSite: 'same-site' }, {})).toEqual({
      ok: true,
      mode: 'local',
    });

    // An unsafe method is not a plain navigation, however it labels itself.
    expect(authorizeRuntimeRequest({ ...navigation, method: 'POST' }, {})).toMatchObject({
      ok: false,
      reason: 'cross_site_request',
    });
    // Cross-site fetch/XHR and subresource loads stay blocked.
    expect(authorizeRuntimeRequest({
      ...navigation,
      secFetchMode: 'cors',
      secFetchDest: 'empty',
    }, {})).toMatchObject({ ok: false, reason: 'cross_site_request' });
    expect(authorizeRuntimeRequest({
      ...navigation,
      secFetchMode: 'no-cors',
      secFetchDest: 'iframe',
    }, {})).toMatchObject({ ok: false, reason: 'cross_site_request' });
    // A disallowed Origin still loses, navigation or not.
    expect(authorizeRuntimeRequest({
      ...navigation,
      origin: 'https://attacker.example',
    }, {})).toMatchObject({ ok: false, reason: 'origin_not_allowed' });
  });

  it('still demands credentials for a cross-site navigation in remote mode', () => {
    const env = remoteEnv();
    const navigation = {
      host: 'robin.example.com',
      secFetchSite: 'cross-site',
      secFetchMode: 'navigate',
      secFetchDest: 'document',
      method: 'GET',
    };
    expect(authorizeRuntimeRequest(navigation, env)).toMatchObject({
      ok: false,
      status: 401,
      reason: 'authentication_required',
    });
    expect(authorizeRuntimeRequest({
      ...navigation,
      authorization: `Bearer ${REMOTE_TOKEN}`,
    }, env)).toEqual({ ok: true, mode: 'authenticated' });
  });

  it('fails closed when authenticated remote mode is incomplete or misspelled', () => {
    expect(getRuntimeSecurityConfig({
      ROBIN_REMOTE_ACCESS: 'authenticated',
      ROBIN_API_TOKEN: REMOTE_TOKEN,
    })).toMatchObject({ mode: 'invalid' });
    expect(getRuntimeSecurityConfig({
      ROBIN_REMOTE_ACCESS: 'true',
      ROBIN_API_TOKEN: REMOTE_TOKEN,
      ROBIN_PUBLIC_ORIGIN: 'https://robin.example.com',
    })).toMatchObject({ mode: 'invalid' });
    expect(authorizeRuntimeRequest({
      host: 'robin.example.com',
      authorization: `Bearer ${REMOTE_TOKEN}`,
    }, {
      ROBIN_REMOTE_ACCESS: 'authenticated',
    })).toMatchObject({
      ok: false,
      status: 503,
      reason: 'invalid_security_config',
    });
  });

  it('requires the exact public Host/Origin and valid remote credentials', () => {
    const env = remoteEnv();
    expect(authorizeRuntimeRequest({
      host: 'robin.example.com',
      origin: 'https://robin.example.com',
      authorization: `Bearer ${REMOTE_TOKEN}`,
      secFetchSite: 'same-origin',
    }, env)).toEqual({ ok: true, mode: 'authenticated' });

    const basic = Buffer.from(`robin:${REMOTE_TOKEN}`, 'utf8').toString('base64');
    expect(authorizeRuntimeRequest({
      host: 'robin.example.com',
      authorization: `Basic ${basic}`,
    }, env)).toEqual({ ok: true, mode: 'authenticated' });

    expect(authorizeRuntimeRequest({
      host: 'internal-proxy:8400',
      authorization: `Bearer ${REMOTE_TOKEN}`,
    }, env)).toMatchObject({ ok: false, reason: 'host_not_allowed' });
    expect(authorizeRuntimeRequest({
      host: 'robin.example.com',
      origin: 'https://attacker.example',
      authorization: `Bearer ${REMOTE_TOKEN}`,
    }, env)).toMatchObject({ ok: false, reason: 'origin_not_allowed' });
    expect(authorizeRuntimeRequest({
      host: 'robin.example.com',
      origin: 'https://robin.example.com',
      authorization: 'Bearer wrong',
    }, env)).toMatchObject({
      ok: false,
      status: 401,
      reason: 'authentication_required',
    });
  });

  it('returns a Basic challenge without leaking configuration detail', async () => {
    const response = guardApiRequest(
      new Request('https://robin.example.com/api/search', {
        headers: { host: 'robin.example.com' },
      }),
      remoteEnv(),
    );
    expect(response?.status).toBe(401);
    expect(response?.headers.get('www-authenticate')).toContain('Basic realm="Robin"');
    expect(await response?.json()).toEqual({ error: 'authentication_required' });
  });
});

describe('voice relay bind policy', () => {
  it('binds to numeric loopback by default', () => {
    expect(getVoiceRelayBindConfig({})).toEqual({
      ok: true,
      host: '127.0.0.1',
      mode: 'local',
    });
  });

  it('rejects a non-loopback relay bind unless remote auth is fully configured', () => {
    expect(getVoiceRelayBindConfig({ INTERVIEW_WS_HOST: '0.0.0.0' })).toMatchObject({
      ok: false,
    });
    expect(getVoiceRelayBindConfig(remoteEnv({
      INTERVIEW_WS_HOST: '0.0.0.0',
    }))).toEqual({
      ok: true,
      host: '0.0.0.0',
      mode: 'authenticated',
    });
  });
});
