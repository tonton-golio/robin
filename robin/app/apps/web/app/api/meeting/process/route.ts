/**
 * POST /api/meeting/process
 *
 * Analyzes a raw meeting transcript with an LLM (via OpenRouter) and returns
 * structured, editable output for the review step:
 *
 *   - title:            a short human meeting title (not a slug)
 *   - summary:          a 2–4 sentence TL;DR
 *   - keyPoints:        the main points discussed
 *   - actionItems:      follow-ups, each with an optional owner
 *   - speakers:         inferred real names per "Speaker N" label (best effort)
 *   - cleanedTranscript: conservative cleanup of the transcript — filler words,
 *                        false starts and obvious STT errors removed, fragmented
 *                        same-speaker lines merged. Wording/meaning preserved.
 *                        Speaker labels kept in **Speaker N:** form so the editor's
 *                        rename machinery still works.
 *
 * Backend: OpenRouter chat completions. Requires OPENROUTER_API_KEY.
 * Model is configurable via OPENROUTER_MODEL (default: anthropic/claude-sonnet-4.5).
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';

interface ActionItem {
  text: string;
  owner: string | null;
}

interface ProcessResult {
  title: string;
  summary: string;
  keyPoints: string[];
  actionItems: ActionItem[];
  speakers: Record<string, string>;
  cleanedTranscript: string;
}

const SYSTEM_PROMPT = [
  'You are a meticulous meeting analyst. You receive a raw, machine-generated meeting',
  'transcript and return a single JSON object — nothing else, no prose, no code fences.',
  '',
  'Cleanup must be CONSERVATIVE. You MAY:',
  '  - remove filler words (um, uh, like, you know), false starts and stutters,',
  '  - drop repeated words and obvious speech-to-text errors,',
  '  - merge consecutive fragments spoken by the same speaker into one line,',
  '  - fix capitalization and punctuation.',
  'You MUST NOT paraphrase, summarize, reorder, or change the meaning or vocabulary of',
  'what was said. Keep every substantive sentence. Preserve speaker labels exactly in the',
  'form "**Speaker 0:**", "**Speaker 1:**" — do NOT replace them with names in the transcript.',
  '',
  'For speaker names: infer each speaker\'s real name ONLY when the transcript makes it clear',
  '(self-introduction, being addressed by name, or a strong attendee match). If unsure, use "".',
].join('\n');

function buildUserPrompt(input: {
  transcript: string;
  durationSec?: number;
  attendees?: string[];
}): string {
  const meta: string[] = [];
  if (typeof input.durationSec === 'number' && input.durationSec > 0) {
    meta.push(`Duration: ~${Math.round(input.durationSec / 60)} min`);
  }
  if (input.attendees && input.attendees.length > 0) {
    meta.push(`Known/expected attendees: ${input.attendees.join(', ')}`);
  }

  return [
    meta.length ? meta.join('\n') : null,
    'Return JSON with exactly this shape:',
    `{
  "title": "short human meeting title, <= 8 words, no date",
  "summary": "2-4 sentence plain-language TL;DR of what happened and was decided",
  "keyPoints": ["the main points discussed, one per item"],
  "actionItems": [{ "text": "the follow-up", "owner": "name or null" }],
  "speakers": { "Speaker 0": "inferred name or empty string", "Speaker 1": "" },
  "cleanedTranscript": "**Speaker 0:** ...\\n\\n**Speaker 1:** ... (full conservatively-cleaned transcript)"
}`,
    'Include a "speakers" entry for every distinct speaker label that appears in the transcript.',
    '',
    'Transcript:',
    input.transcript,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function coerceResult(raw: unknown, fallbackTranscript: string): ProcessResult {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';

  const keyPoints = Array.isArray(obj.keyPoints)
    ? obj.keyPoints.map((p) => String(p).trim()).filter(Boolean)
    : [];

  const actionItems: ActionItem[] = Array.isArray(obj.actionItems)
    ? obj.actionItems
        .map((item) => {
          if (item && typeof item === 'object') {
            const rec = item as Record<string, unknown>;
            const text = typeof rec.text === 'string' ? rec.text.trim() : '';
            const ownerRaw = rec.owner;
            const owner = typeof ownerRaw === 'string' && ownerRaw.trim() ? ownerRaw.trim() : null;
            return { text, owner };
          }
          return { text: String(item).trim(), owner: null };
        })
        .filter((a) => a.text)
    : [];

  const speakers: Record<string, string> = {};
  if (obj.speakers && typeof obj.speakers === 'object') {
    for (const [k, v] of Object.entries(obj.speakers as Record<string, unknown>)) {
      speakers[k] = typeof v === 'string' ? v.trim() : '';
    }
  }

  const cleanedTranscript =
    typeof obj.cleanedTranscript === 'string' && obj.cleanedTranscript.trim()
      ? obj.cleanedTranscript.trim()
      : fallbackTranscript;

  return { title, summary, keyPoints, actionItems, speakers, cleanedTranscript };
}

// Models sometimes wrap JSON in ```json fences despite instructions.
function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Last resort: grab the outermost {...}.
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return JSON.parse(candidate.slice(first, last + 1));
    }
    throw new Error('Model did not return valid JSON.');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY is not set. Add it to apps/web/.env.local to enable AI processing.' },
      { status: 503 },
    );
  }

  let body: { transcript?: unknown; durationSec?: unknown; attendees?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) {
    return NextResponse.json({ error: 'Missing or empty `transcript` field' }, { status: 400 });
  }

  const durationSec = typeof body.durationSec === 'number' ? body.durationSec : undefined;
  const attendees = Array.isArray(body.attendees)
    ? body.attendees.map((a) => String(a).trim()).filter(Boolean)
    : typeof body.attendees === 'string'
      ? body.attendees.split(',').map((a) => a.trim()).filter(Boolean)
      : undefined;

  const model = process.env['OPENROUTER_MODEL'] || DEFAULT_MODEL;

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://robin.local',
        'X-Title': 'Robin Meeting Recorder',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 8000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt({ transcript, durationSec, attendees }) },
        ],
      }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to reach OpenRouter: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return NextResponse.json(
      { error: `OpenRouter error ${res.status}`, detail: detail.slice(0, 500) },
      { status: 502 },
    );
  }

  let content: string;
  try {
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    content = data.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    return NextResponse.json(
      { error: `Could not parse OpenRouter response: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  if (!content.trim()) {
    return NextResponse.json({ error: 'OpenRouter returned an empty response.' }, { status: 502 });
  }

  let parsed: unknown;
  try {
    parsed = extractJson(content);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Model did not return valid JSON.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ model, ...coerceResult(parsed, transcript) });
}
