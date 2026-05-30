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
  /**
   * Client-supplied conversation id. Each conversation (browser tab) gets its
   * own session file so concurrent tabs / a quick second send don't cross-
   * contaminate each other's Claude session via the shared resume id.
   */
  conversationId?: string;
  /**
   * Aborts the in-flight turn: kills the spawned CLI and stops streaming. Wired
   * from the HTTP request signal so a client disconnect (navigation / tab close)
   * tears down the agent process instead of leaking it.
   */
  signal?: AbortSignal;
}

// Hard cap on a single turn. A hung CLI (network stall, MCP deadlock, waiting on
// an interactive prompt) would otherwise keep the SSE response — and the child
// process — alive forever. Override with ASSISTANT_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function timeoutMs(): number {
  const raw = Number(process.env['ASSISTANT_TIMEOUT_MS']);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * Build a minimal environment for the spawned `claude` CLI instead of leaking
 * the entire server environment (every provider API key, secrets used by other
 * routes) into an agentic child the caller controls the prompt of. We pass only
 * what the CLI needs to run plus an allowlist of ASSISTANT_, ROBIN_, CLAUDE_ and
 * ANTHROPIC_ prefixed keys. Extend via ASSISTANT_ENV_PASSTHROUGH (comma-list).
 */
function childEnv(): NodeJS.ProcessEnv {
  const src = process.env;
  const out: Record<string, string> = {};
  const baseKeys = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'SHELL', 'NODE_ENV'];
  for (const key of baseKeys) {
    const v = src[key];
    if (v !== undefined) out[key] = v;
  }
  const passthrough = (src['ASSISTANT_ENV_PASSTHROUGH'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const [key, value] of Object.entries(src)) {
    if (value === undefined) continue;
    if (
      key.startsWith('ASSISTANT_') ||
      key.startsWith('ROBIN_') ||
      key.startsWith('CLAUDE_') ||
      key.startsWith('ANTHROPIC_') ||
      passthrough.includes(key)
    ) {
      out[key] = value;
    }
  }
  // Cast: the project augments ProcessEnv to require NODE_ENV (included above);
  // the curated record satisfies spawn's env option.
  return out as NodeJS.ProcessEnv;
}

// Restrict a client-supplied conversation id to a safe filename fragment so it
// can never escape the sessions directory or collide with the legacy file.
function safeConvId(id: string | undefined): string | null {
  if (!id) return null;
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

function sessionFile(conversationId?: string): string {
  const override = process.env['ASSISTANT_SESSION_FILE'];
  if (override) return override;
  const convId = safeConvId(conversationId);
  // Per-conversation file when an id is supplied; legacy single file otherwise
  // (keeps single-tab / id-less callers working as before).
  return convId
    ? vaultPath('.robin', 'assistant-sessions', `${convId}.json`)
    : vaultPath('.robin', 'assistant-session.json');
}

async function readSessionId(conversationId?: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(sessionFile(conversationId), 'utf-8');
    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    return typeof parsed.sessionId === 'string' && parsed.sessionId ? parsed.sessionId : null;
  } catch {
    return null;
  }
}

async function writeSessionId(sessionId: string, conversationId?: string): Promise<void> {
  const file = sessionFile(conversationId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ sessionId, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
}

async function clearSessionId(conversationId?: string): Promise<void> {
  try {
    await fs.rm(sessionFile(conversationId));
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

  const convId = options.conversationId;
  if (options.reset) await clearSessionId(convId);

  const args = [
    '-p',
    options.text,
    '--output-format',
    'stream-json',
    '--append-system-prompt',
    systemPrompt(options.mode),
  ];

  const sessionId = await readSessionId(convId);
  if (sessionId) args.push('--resume', sessionId);

  const cwd = process.env['ASSISTANT_CLAUDE_CWD'] ?? locateVault();
  const proc = spawn('claude', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Minimal allowlisted env — do NOT hand the child every server secret.
    env: childEnv(),
  });

  // Tear the child down on timeout or client disconnect. SIGTERM first, then
  // SIGKILL after a short grace period so a wedged CLI can't linger.
  let timedOut = false;
  let killed = false;
  const killChild = (): void => {
    if (killed) return;
    killed = true;
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    }, 2000).unref();
  };

  const watchdog = setTimeout(() => {
    timedOut = true;
    killChild();
  }, timeoutMs());
  watchdog.unref();

  const signal = options.signal;
  const onAbort = (): void => killChild();
  if (signal) {
    if (signal.aborted) killChild();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

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
        await writeSessionId(ev.session_id, convId);
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
    clearTimeout(watchdog);
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve(proc.exitCode);
      return;
    }
    proc.once('close', (code) => resolve(code));
  });

  if (timedOut) {
    yield { type: 'error', message: 'Assistant timed out.' };
    return;
  }

  // Client went away mid-turn: we killed the child on purpose, so don't emit a
  // spurious error event (the connection is already gone anyway).
  if (signal?.aborted) return;

  if (exitCode !== 0 && !emittedText) {
    const message = stderr.trim() || 'Claude CLI returned an error.';
    yield { type: 'error', message };
    return;
  }

  yield { type: 'done', sessionId: latestSessionId };
}
