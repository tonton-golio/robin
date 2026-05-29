/**
 * GET /api/meeting/deepgram-token
 *
 * Mints a short-lived Deepgram access token so the browser can open a
 * streaming WebSocket directly to Deepgram WITHOUT exposing the long-lived
 * DEEPGRAM_API_KEY to the client.
 *
 * Uses Deepgram's token-grant endpoint (POST /v1/auth/grant). The returned
 * `access_token` is a short-TTL credential the browser passes as the
 * `token` WebSocket subprotocol when connecting to wss://api.deepgram.com.
 *
 * Returns:
 *   200 { access_token, expires_in }
 *   503 { error, hint }   — when DEEPGRAM_API_KEY is not configured
 *   502 { error, detail } — when Deepgram rejects the grant
 */

import { NextResponse } from 'next/server';
import { buildMeetingKeyterms } from '@/lib/meeting-keyterms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isLoopbackHost(request: Request): boolean {
  const host = ((request.headers.get('host') ?? '').split(':')[0] ?? '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

export async function GET(request: Request): Promise<NextResponse> {
  const apiKey = process.env['DEEPGRAM_API_KEY'];
  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'DEEPGRAM_API_KEY is not set',
        hint: 'Add DEEPGRAM_API_KEY=... to robin/app/apps/web/.env.local and restart the dev server. Get a key at https://console.deepgram.com.',
      },
      { status: 503 },
    );
  }

  // Domain keyterms (names + product terms) the browser appends to the
  // streaming URL so Nova-3 biases toward them. Non-fatal if the brain
  // can't be read.
  const keyterms = await buildMeetingKeyterms().catch(() => [] as string[]);

  try {
    // Preferred: mint a short-lived grant token so the raw API key never
    // reaches the browser. ttl_seconds=60 is plenty — the browser uses it
    // once, immediately, to open the WebSocket.
    const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });

    if (res.ok) {
      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (data.access_token) {
        return NextResponse.json({
          access_token: data.access_token,
          expires_in: data.expires_in ?? 60,
          ephemeral: true,
          keyterms,
        });
      }
    }

    // Fallback: this key can't mint grant tokens (needs an owner-scoped key).
    // For a localhost-only single-user tool we hand the key to the local
    // browser directly — Deepgram accepts it as the `token` WS subprotocol.
    // Hard-gate this to loopback requests so the long-lived key can never leak
    // if the server is ever bound to a non-localhost interface.
    if (!isLoopbackHost(request)) {
      return NextResponse.json(
        {
          error: 'Deepgram grant unavailable',
          hint: 'This key cannot mint short-lived grant tokens. Create an owner-role key in the Deepgram console so the grant endpoint succeeds; the raw key is only ever exposed to loopback clients.',
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      access_token: apiKey,
      expires_in: null,
      ephemeral: false,
      keyterms,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to reach Deepgram', detail: String(err) },
      { status: 502 },
    );
  }
}
