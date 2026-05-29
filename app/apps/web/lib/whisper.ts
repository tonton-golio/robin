/**
 * Whisper transcription adapter.
 *
 * ROBIN_WHISPER_MODE env controls the backend:
 *   stub   (default in tests) — returns fixture text or "stub transcript"
 *   local  (default in prod)  — calls whisper-node with base.en model
 *   openai                    — POSTs to OpenAI Whisper API
 *
 * NOTE (v1 limitation): transcription is synchronous. A 30-min meeting at
 * ~15x real-time via whisper.cpp takes ~2 min. For long sessions the HTTP
 * request will just sit open. Phase 2 should move this to a background job
 * with SSE progress events.
 */

import fs from 'fs/promises';
import path from 'path';

export interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface TranscriptResult {
  transcript: string;
  segments?: Segment[];
}

type WhisperMode = 'stub' | 'local' | 'openai';

function getMode(): WhisperMode {
  const raw = process.env['ROBIN_WHISPER_MODE'] ?? 'local';
  if (raw === 'stub' || raw === 'local' || raw === 'openai') return raw;
  console.warn(`[whisper] Unknown ROBIN_WHISPER_MODE="${raw}", falling back to "local"`);
  return 'local';
}

/**
 * Transcribe an audio file. audioPath is vault-relative (or absolute).
 * The caller is responsible for ensuring the file exists before calling.
 */
export async function transcribe(audioPath: string): Promise<TranscriptResult> {
  const mode = getMode();

  switch (mode) {
    case 'stub':
      return transcribeStub(audioPath);
    case 'local':
      return transcribeLocal(audioPath);
    case 'openai':
      return transcribeOpenAI(audioPath);
  }
}

// ── Stub ──────────────────────────────────────────────────────────────────────

async function transcribeStub(audioPath: string): Promise<TranscriptResult> {
  const basename = path.basename(audioPath, path.extname(audioPath));
  const fixtureDir = path.resolve(process.cwd(), 'tests/fixtures/transcripts');
  const fixturePath = path.join(fixtureDir, `${basename}.txt`);

  try {
    const text = await fs.readFile(fixturePath, 'utf-8');
    return {
      transcript: text.trim(),
      segments: undefined,
    };
  } catch {
    // No fixture — return generic stub text
    return {
      transcript: 'stub transcript',
      segments: [
        { start: 0, end: 5, text: 'stub transcript', speaker: 'A' },
      ],
    };
  }
}

// ── Local (whisper-node / whisper.cpp) ────────────────────────────────────────

async function transcribeLocal(audioPath: string): Promise<TranscriptResult> {
  // Dynamic import so the module is only loaded in local mode. whisper-node
  // may not be installed in CI, so guard gracefully.
  let nodeWhisper: { whisper: (filePath: string, options?: Record<string, unknown>) => Promise<unknown[]> };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nodeWhisper = require('whisper-node');
  } catch (err) {
    throw new Error(
      'whisper-node is not installed. Run: npm install whisper-node. ' +
      'Alternatively set ROBIN_WHISPER_MODE=openai and provide OPENAI_API_KEY. ' +
      `(original error: ${String(err)})`,
    );
  }

  const absPath = path.isAbsolute(audioPath)
    ? audioPath
    : path.resolve(process.cwd(), audioPath);

  type WhisperSegment = {
    start: string | number;
    end: string | number;
    speech: string;
  };

  // whisper-node returns an array of segment objects
  const raw = await nodeWhisper.whisper(absPath, {
    modelName: 'base.en',
    whisperOptions: {
      word_timestamps: false,
    },
  }) as WhisperSegment[];

  const segments: Segment[] = raw.map((s) => ({
    start: typeof s.start === 'number' ? s.start : parseFloat(String(s.start)),
    end: typeof s.end === 'number' ? s.end : parseFloat(String(s.end)),
    text: s.speech?.trim() ?? '',
    speaker: undefined, // whisper.cpp base.en does not do diarization
  }));

  const transcript = segments.map(s => s.text).join(' ').trim();

  return { transcript, segments };
}

// ── OpenAI Whisper API ────────────────────────────────────────────────────────

async function transcribeOpenAI(audioPath: string): Promise<TranscriptResult> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY env var is required for ROBIN_WHISPER_MODE=openai');
  }

  const absPath = path.isAbsolute(audioPath)
    ? audioPath
    : path.resolve(process.cwd(), audioPath);

  const fileBuffer = await fs.readFile(absPath);
  const filename = path.basename(absPath);

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: 'audio/webm' }), filename);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI Whisper API error ${res.status}: ${body}`);
  }

  const json = await res.json() as {
    text: string;
    segments?: Array<{ start: number; end: number; text: string }>;
  };

  const segments: Segment[] | undefined = json.segments?.map(s => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
    speaker: undefined,
  }));

  return { transcript: json.text.trim(), segments };
}
