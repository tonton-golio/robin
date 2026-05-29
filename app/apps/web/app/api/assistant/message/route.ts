import { NextRequest } from 'next/server';
import { streamAssistantEvents } from '@/lib/assistant-relay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function encodeSse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: { text?: unknown; mode?: unknown; reset?: unknown };
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const event of streamAssistantEvents({ text, mode, reset })) {
          controller.enqueue(encoder.encode(encodeSse(event)));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            encodeSse({
              type: 'error',
              message: err instanceof Error ? err.message : String(err),
            }),
          ),
        );
      } finally {
        controller.close();
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
