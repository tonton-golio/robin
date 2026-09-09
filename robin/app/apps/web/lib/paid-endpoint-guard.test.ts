import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getDeepgramToken } from '@/app/api/meeting/deepgram-token/route';

const SECURITY_ENV_KEYS = [
  'ROBIN_REMOTE_ACCESS',
  'ROBIN_API_TOKEN',
  'ROBIN_PUBLIC_ORIGIN',
  'DEEPGRAM_API_KEY',
] as const;

const originalEnv = Object.fromEntries(
  SECURITY_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof SECURITY_ENV_KEYS)[number], string | undefined>;

describe('paid credential endpoint guard ordering', () => {
  beforeEach(() => {
    process.env['ROBIN_REMOTE_ACCESS'] = 'local';
    delete process.env['ROBIN_API_TOKEN'];
    delete process.env['ROBIN_PUBLIC_ORIGIN'];
    process.env['DEEPGRAM_API_KEY'] = 'must-not-be-used';
  });

  afterEach(() => {
    for (const key of SECURITY_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
  });

  it('rejects an untrusted Host before contacting the credential provider', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await getDeepgramToken(new Request(
      'http://192.168.1.20:8400/api/meeting/deepgram-token',
      {
        headers: {
          host: '192.168.1.20:8400',
          origin: 'http://192.168.1.20:8400',
        },
      },
    ));

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
