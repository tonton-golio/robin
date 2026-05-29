import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { locateVault, vaultPath } from './vault';
import { ownerLabel, ownerPossessive } from './config';

const OWNER = ownerLabel; // configured owner display name, or "You" when unset
const OWNER_POSS = ownerPossessive(); // configured owner possessive, or "your" when unset

export type AssistantEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; text: string }
  | { type: 'done'; sessionId?: string }
  | { type: 'error'; message: string };

const VOICE_PROMPT =
  `You are ${OWNER_POSS} AI chief of staff inside Robin, a local-first personal brain. ` +
  'Answer from the Robin vault and available tools first. Be direct, concise, and practical. ' +
  `When you use tools, keep the final answer focused on what ${OWNER} should know or do next.`;

const TALK_PROMPT =
  `You are interviewing ${OWNER} to extract ${OWNER_POSS} thinking on a specific topic. ` +
  'Ask one question at a time, keep questions short, and push for concrete details when answers are vague.';

interface StreamOptions {
  text: string;
  mode?: 'assistant' | 'talk';
  reset?: boolean;
}

function sessionFile(): string {
  return process.env['ASSISTANT_SESSION_FILE'] ?? vaultPath('.robin', 'assistant-session.json');
}

async function readSessionId(): Promise<string | null> {
  try {
    const raw = await fs.readFile(sessionFile(), 'utf-8');
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    return typeof parsed.sessionId === 'string' && parsed.sessionId ? parsed.sessionId : null;
  } catch {
    return null;
  }
}

async function writeSessionId(sessionId: string): Promise<void> {
  const file = sessionFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ sessionId, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
}

async function clearSessionId(): Promise<void> {
  try {
    await fs.rm(sessionFile());
  } catch {
    // No previous session.
  }
}

function systemPrompt(mode: StreamOptions['mode']): string {
  return mode === 'talk' ? TALK_PROMPT : VOICE_PROMPT;
}

export async function* streamAssistantEvents(options: StreamOptions): AsyncGenerator<AssistantEvent> {
  const mode = process.env['ASSISTANT_MODE'] ?? 'claude';
  if (mode === 'stub') {
    yield { type: 'thinking', text: 'Stub assistant received the prompt.' };
    yield { type: 'text', text: `Stub response: ${options.text}` };
    yield { type: 'done' };
    return;
  }

  if (options.reset) await clearSessionId();

  const args = [
    '-p',
    options.text,
    '--output-format',
    'stream-json',
    '--append-system-prompt',
    systemPrompt(options.mode),
  ];

  const sessionId = await readSessionId();
  if (sessionId) args.push('--resume', sessionId);

  const cwd = process.env['ASSISTANT_CLAUDE_CWD'] ?? locateVault();
  const proc = spawn('claude', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let stderr = '';
  proc.stderr.setEncoding('utf-8');
  proc.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  proc.on('error', (err) => {
    stderr += err.message;
  });

  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  let emittedText = false;
  let latestSessionId = sessionId ?? undefined;

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (ev.type === 'system' && ev.subtype === 'init' && typeof ev.session_id === 'string') {
        latestSessionId = ev.session_id;
        await writeSessionId(ev.session_id);
      }

      if (ev.type === 'assistant') {
        const msg = (ev.message ?? ev) as { content?: Array<Record<string, unknown>> };
        for (const block of msg.content ?? []) {
          if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) {
            yield { type: 'thinking', text: block.thinking };
          } else if (block.type === 'text' && typeof block.text === 'string' && block.text) {
            emittedText = true;
            yield { type: 'text', text: block.text };
          } else if (block.type === 'tool_use') {
            yield {
              type: 'tool_use',
              name: typeof block.name === 'string' ? block.name : 'tool',
              input: block.input,
            };
          }
        }
      }

      if (ev.type === 'user') {
        const msg = (ev.message ?? ev) as { content?: Array<Record<string, unknown>> };
        for (const block of msg.content ?? []) {
          if (block.type !== 'tool_result') continue;
          const content = block.content;
          const text = Array.isArray(content)
            ? content
                .map((part) =>
                  part && typeof part === 'object' && 'text' in part
                    ? String((part as { text?: unknown }).text ?? '')
                    : '',
                )
                .join(' ')
            : String(content ?? '');
          if (text) yield { type: 'tool_result', text: text.slice(0, 1200) };
        }
      }
    }
  } finally {
    rl.close();
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    proc.once('close', (code) => resolve(code));
  });

  if (exitCode !== 0 && !emittedText) {
    const message = stderr.trim() || 'Claude CLI returned an error.';
    yield { type: 'error', message };
    return;
  }

  yield { type: 'done', sessionId: latestSessionId };
}
