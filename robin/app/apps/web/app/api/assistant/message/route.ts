import { NextRequest } from 'next/server';
import { streamAssistantEvents } from '@/lib/assistant-relay';
import { isOriginAllowed } from '@/lib/interview-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function encodeSse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Same-origin guard. This route spawns an agentic `claude` CLI with the vault
 * as cwd and full tool access, so a cross-site POST (any page the owner visits
 * while the dev server runs) must not be able to drive it. Next does not
 * enforce CSRF, so we reject requests whose Sec-Fetch-Site is cross-site, or
 * whose Origin is not in the localhost/allowlist set. Same-origin browser
 * fetches send Sec-Fetch-Site: same-origin and a matching Origin.
 */
function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  // Modern browsers set this; same-origin / none (address-bar) are trusted.
  if (site) return site === 'same-origin' || site === 'none';
  // Fallback for clients without Sec-Fetch metadata: check Origin allowlist.
  const origin = request.headers.get('origin');
  if (origin === null) return true; // non-browser / same-origin GET-style client
  return isOriginAllowed(origin);
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return Response.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  }

  let body: { text?: unknown; mode?: unknown; reset?: unknown; conversationId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return Response.json({ error: '`text` is required' }, { status: 400 });
  }

  const mode = body.mode === 'talk' ? 'talk' : 'assistant';
  const reset = body.reset === true;
  const conversationId =
    typeof body.conversationId === 'string' ? body.conversationId : undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      // Enqueueing into an already-closed/cancelled stream (client disconnected)
      // throws; swallow it so a disconnect doesn't surface as an unhandled error.
      const safeEnqueue = (data: unknown): void => {
        if (request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(data)));
        } catch {
          /* stream already torn down */
        }
      };
      try {
        // request.signal aborts when the client disconnects (navigation / tab
        // close); the relay uses it to kill the spawned CLI instead of leaking it.
        for await (const event of streamAssistantEvents({
          text,
          mode,
          reset,
          conversationId,
          signal: request.signal,
        })) {
          safeEnqueue(event);
        }
      } catch (err) {
        safeEnqueue({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
