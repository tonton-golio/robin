import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The HMAC secret is cached on globalThis (not in a module-level binding) so the
// mint route and the relay's verify path — which Next.js loads in SEPARATE
// module graphs within the same process — share one key. Clear that shared slot
// and any pinned env between tests so each case starts from a clean secret.
const SECRET_KEY = '__robinInterviewSessionSecret__';
function clearSharedSecret(): void {
  delete (globalThis as Record<string, unknown>)[SECRET_KEY];
}

describe('interview session token', () => {
  beforeEach(() => {
    vi.resetModules();
    clearSharedSecret();
    delete process.env['INTERVIEW_SESSION_SECRET'];
  });
  afterEach(() => {
    clearSharedSecret();
    delete process.env['INTERVIEW_SESSION_SECRET'];
  });

  it('round-trips a freshly minted token', async () => {
    const { mintSessionToken, verifySessionToken } = await import('./interview-session-token');
    const token = mintSessionToken('quick');
    expect(verifySessionToken(token, 'quick')).toMatchObject({ ok: true, briefSlug: 'quick' });
  });

  it('rejects mismatched brief, tampered signature, and missing token', async () => {
    const { mintSessionToken, verifySessionToken } = await import('./interview-session-token');
    const token = mintSessionToken('quick');
    expect(verifySessionToken(token, 'other')).toMatchObject({ ok: false, reason: 'brief_mismatch' });
    expect(verifySessionToken(`${token}x`, 'quick').ok).toBe(false);
    expect(verifySessionToken(null, 'quick')).toMatchObject({ ok: false, reason: 'missing_token' });
  });

  // Regression: under Next.js the mint route (App Router) and the verify path
  // (relay booted from instrumentation.ts) load this module in SEPARATE module
  // graphs. A module-level secret diverges between them, so every token fails
  // bad_signature and the relay closes the socket with 4401 → the browser
  // reconnect-loops forever ("Reconnecting…"). The secret living on globalThis
  // makes both instances resolve the SAME key. resetModules() reproduces the
  // second graph: a fresh module instance, same process (shared globalThis).
  it('a token minted in one module instance verifies in a SEPARATE instance', async () => {
    const a = await import('./interview-session-token');
    const token = a.mintSessionToken('quick');

    vi.resetModules(); // drop the module from the registry → next import re-evaluates it
    const b = await import('./interview-session-token');
    expect(b.verifySessionToken).not.toBe(a.verifySessionToken); // genuinely a fresh instance

    // On the old module-level-secret code this is bad_signature; the fix makes it ok.
    expect(b.verifySessionToken(token, 'quick')).toMatchObject({ ok: true });
  });

  it('honours a pinned INTERVIEW_SESSION_SECRET across instances', async () => {
    process.env['INTERVIEW_SESSION_SECRET'] = 'pinned-test-secret';
    const a = await import('./interview-session-token');
    const token = a.mintSessionToken('quick');

    // A genuinely separate process can't share globalThis — pinning the secret
    // via env is the documented fallback that still lets verify reproduce the key.
    vi.resetModules();
    clearSharedSecret();
    const b = await import('./interview-session-token');
    expect(b.verifySessionToken(token, 'quick').ok).toBe(true);
  });
});
