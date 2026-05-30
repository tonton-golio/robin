/**
 * Node-side WebSocket relay: browser <-> xAI Realtime.
 *
 * Ports the protocol from interviewer_voice2voice/backend/app/voice_relay.py.
 *
 * Lifecycle:
 *   1. Browser connects to our WS server.
 *   2. We open a WS to xAI Realtime with Authorization header.
 *   3. We inject session.update (system prompt + tool defs + audio config).
 *   4. We bridge frames bidirectionally.
 *   5. On speech_started → send response.cancel upstream (barge-in).
 *   6. On response.function_call_arguments.done for search_background →
 *      run pageSearch, send conversation.item.create + response.create.
 *   7. On either side closing → close the other.
 *
 * Stub mode: if ROBIN_XAI_MODE=stub, we echo scripted frames without
 * connecting to xAI. Useful for tests.
 */

import WebSocket from "ws";
import { buildSystemPrompt, safeInterviewSlug } from "./build-system-prompt";
import { locateVault } from "./vault";
import { InterviewTranscriptStore } from "./interview-transcript-store";

export type InterviewXaiMode = "real" | "stub";

export interface InterviewRuntimeConfig {
  apiKey?: string;
  mode: InterviewXaiMode;
  model: string;
  voice: string;
  wsPort: number;
  realtimeUrl: string;
  sampleRate: number;
}

export const INTERVIEW_DEFAULTS = {
  mode: "real" as InterviewXaiMode,
  model: "grok-voice-think-fast-1.0",
  voice: "eve",
  wsPort: 8401,
  realtimeUrl: "wss://api.x.ai/v1/realtime",
  sampleRate: 24000,
};

function readNonEmptyEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function readPositiveIntEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = readNonEmptyEnv(env, key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getInterviewRuntimeConfig(env: NodeJS.ProcessEnv = process.env): InterviewRuntimeConfig {
  const mode = readNonEmptyEnv(env, "ROBIN_XAI_MODE") === "stub" ? "stub" : INTERVIEW_DEFAULTS.mode;

  return {
    apiKey: readNonEmptyEnv(env, "XAI_API_KEY"),
    mode,
    model: readNonEmptyEnv(env, "INTERVIEW_MODEL") ?? INTERVIEW_DEFAULTS.model,
    voice: readNonEmptyEnv(env, "INTERVIEW_VOICE") ?? INTERVIEW_DEFAULTS.voice,
    wsPort: readPositiveIntEnv(env, "INTERVIEW_WS_PORT", INTERVIEW_DEFAULTS.wsPort),
    realtimeUrl: readNonEmptyEnv(env, "XAI_REALTIME_URL") ?? INTERVIEW_DEFAULTS.realtimeUrl,
    sampleRate: INTERVIEW_DEFAULTS.sampleRate,
  };
}

// ── Reconnect-resumable session state ───────────────────────────────────────
//
// The browser VoiceClient auto-reconnects on a dropped socket (see
// lib/voice-client.ts: up to MAX_RECONNECT_ATTEMPTS with backoff). Each
// reconnect opens a fresh browser WS → a fresh handleRelayConnection → a fresh,
// memoryless upstream xAI session. Left naive, every reconnect re-sends the
// opening greeting, the model forgets everything discussed so far, and the
// durable .live transcript is split into a new file. To the user a transient
// network blip looks like "the AI forgot everything".
//
// We keep a small per-brief session record alive briefly across the gap so a
// reconnect can (a) reuse the same transcript file and (b) replay prior turns
// into the new upstream session and skip the greeting. A fresh start (outside
// the window, or after a clean stop) begins clean.

interface ReplayTurn {
  role: "user" | "assistant";
  text: string;
}

interface VoiceSessionState {
  transcriptStore: InterviewTranscriptStore;
  turns: ReplayTurn[];
  /** Set when the browser socket closes; the record is reusable until it expires. */
  disconnectedAt: number | null;
}

// Window after a disconnect during which a new connection for the same brief is
// treated as a reconnect (resume) rather than a new session. Comfortably covers
// the client's backoff schedule (5 attempts, max ~8s each ≈ <40s) plus slack.
const RECONNECT_RESUME_WINDOW_MS = 90_000;

// Cap how many prior turns we replay into a fresh upstream session on reconnect.
// session.turns grows for the whole interview; replaying ALL of it on every
// reconnect re-sends an ever-larger history, multiplying upstream token cost and
// latency and eventually risking context-window overflow on a long session. We
// keep the full turns log intact (for dedup/transcript) but only replay the tail.
const MAX_REPLAY_TURNS = 40;

// Keyed by safe brief slug. Survives Next dev hot-reloads via globalThis so an
// in-flight reconnect isn't orphaned by a reload.
const VOICE_SESSION_KEY = "__robinVoiceSessions__";
function voiceSessions(): Map<string, VoiceSessionState> {
  const g = globalThis as unknown as Record<string, Map<string, VoiceSessionState> | undefined>;
  if (!g[VOICE_SESSION_KEY]) g[VOICE_SESSION_KEY] = new Map();
  return g[VOICE_SESSION_KEY] as Map<string, VoiceSessionState>;
}

// Tool definition mirroring voice_relay.py
const SEARCH_TOOL = {
  type: "function",
  name: "search_background",
  description:
    "Search the interviewer's background-knowledge library for the most " +
    "relevant sections. Use this whenever the brief alludes to a topic " +
    "you don't have details for — a number, a person's preference, a " +
    "prior decision, a project status. Pass a short natural-language " +
    "query; keywords work, but slug-style phrases like 'project " +
    "budget' or 'hiring plan workflow' are fine too. Returns " +
    "section-level hits with file, heading, page summary, and a " +
    "snippet — quote the file and heading when you cite.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to look up, e.g. 'AI investment budget' or 'communication style'.",
      },
      k: {
        type: "integer",
        description: "How many snippets to return (default 5, max 8).",
      },
    },
    required: ["query"],
  },
};

function buildSessionUpdate(systemPrompt: string, config: InterviewRuntimeConfig): object {
  return {
    type: "session.update",
    session: {
      voice: config.voice,
      instructions: systemPrompt,
      turn_detection: {
        type: "server_vad",
        // Default-ish sensitivity so normal speaking volume reliably registers
        // as a turn. We don't need a high threshold to avoid the interviewer
        // talking over itself — the client's half-duplex guard already stops
        // mic frames from being sent while the AI's audio is still playing.
        threshold: 0.5,
        silence_duration_ms: 700,
        prefix_padding_ms: 300,
      },
      audio: {
        input: { format: { type: "audio/pcm", rate: config.sampleRate } },
        output: { format: { type: "audio/pcm", rate: config.sampleRate } },
      },
      input_audio_transcription: { model: "whisper-1" },
      tools: [SEARCH_TOOL],
    },
  };
}

// ── Search implementation ─────────────────────────────────────────────────────

interface SearchHit {
  slug: string;
  path: string;
  title: string | null;
  summary: string | null;
  score: number;
  snippet?: string;
}

// Module-level indexer cache keyed by vaultPath
let _indexerCache: {
  indexer: { search: (q: string, opts?: { k?: number }) => Promise<SearchHit[]> };
  vaultRoot: string;
} | null = null;

async function getIndexer(vaultRoot: string) {
  if (_indexerCache && _indexerCache.vaultRoot === vaultRoot) {
    return _indexerCache.indexer;
  }
  try {
    // Dynamic import to avoid hard dependency crash at startup
    const mod = await import("@robin/indexer" as string) as {
      createIndexer: (opts: { vaultPath: string }) => Promise<{
        search: (q: string, opts?: { k?: number }) => Promise<SearchHit[]>;
      }>;
    };
    const indexer = await mod.createIndexer({ vaultPath: vaultRoot });
    _indexerCache = { indexer, vaultRoot };
    return indexer;
  } catch {
    return null;
  }
}

async function pageSearch(query: string, k = 5): Promise<string> {
  const vaultRoot = locateVault();
  const indexer = await getIndexer(vaultRoot);
  if (!indexer) {
    return JSON.stringify({ query, results: [], note: "Indexer unavailable." });
  }
  try {
    const hits = await indexer.search(query, { k });
    if (!hits.length) {
      return JSON.stringify({
        query,
        results: [],
        note: "No matching sections. Try a broader or different query.",
      });
    }
    const results = hits.map((h) => ({
      slug: h.slug,
      title: h.title,
      summary: h.summary,
      snippet: h.snippet ? h.snippet.slice(0, 1200) : undefined,
      score: Math.round(h.score * 100) / 100,
    }));
    return JSON.stringify({ query, results });
  } catch (e) {
    return JSON.stringify({ query, results: [], error: String(e) });
  }
}

// ── Stub frames for test mode ─────────────────────────────────────────────────

function* stubFrames(): Generator<string> {
  yield JSON.stringify({ type: "session.created", session: { id: "stub-session" } });
  yield JSON.stringify({ type: "session.updated", session: { id: "stub-session" } });
  yield JSON.stringify({
    type: "response.audio_transcript.delta",
    delta: "Hello! I'm your AI interviewer. ",
  });
  yield JSON.stringify({
    type: "response.audio_transcript.delta",
    delta: "Let's get started with the brief. ",
  });
  yield JSON.stringify({
    type: "response.audio_transcript.done",
    transcript: "Hello! I'm your AI interviewer. Let's get started with the brief.",
  });
}

// ── Main relay function ───────────────────────────────────────────────────────

/**
 * Attach relay logic to an already-established browser WebSocket connection.
 * Called by the WS server in the API route.
 */
export async function handleRelayConnection(
  browserWs: WebSocket,
  briefSlug: string,
): Promise<void> {
  const config = getInterviewRuntimeConfig();
  const safeBriefSlug = safeInterviewSlug(briefSlug);

  // Resume vs. fresh: a session record left behind by a recently-dropped socket
  // for the same brief means this connection is a reconnect. Reuse its
  // transcript store (same file) and replay its turns into the new upstream.
  const sessions = voiceSessions();
  const prior = sessions.get(safeBriefSlug);
  const isResume =
    prior != null &&
    prior.disconnectedAt != null &&
    Date.now() - prior.disconnectedAt <= RECONNECT_RESUME_WINDOW_MS;

  // Server-side transcript capture. The relay sees every frame, so it can
  // persist the conversation to the vault independently of the browser — the
  // transcript survives closing the tab or a crash. The app's "Save & Ingest"
  // remains the canonical, indexed copy; this is the crash-safety net. On a
  // reconnect we keep writing to the same file rather than splitting it.
  const session: VoiceSessionState = isResume
    ? prior!
    : { transcriptStore: new InterviewTranscriptStore(safeBriefSlug), turns: [], disconnectedAt: null };
  session.disconnectedAt = null;
  sessions.set(safeBriefSlug, session);
  const transcriptStore = session.transcriptStore;

  // Mirror committed turns the relay observes so a later reconnect can replay
  // the conversation into a fresh (memoryless) upstream session.
  const recordTurn = (role: ReplayTurn["role"], text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const last = session.turns[session.turns.length - 1];
    // Skip a verbatim repeat (the same done-event re-fired, or a user turn whose
    // transcription arrives twice) so replay stays clean.
    if (last && last.role === role && last.text === trimmed) return;
    session.turns.push({ role, text: trimmed });
  };

  let transcriptClosed = false;
  const closeTranscript = (): void => {
    if (transcriptClosed) return;
    transcriptClosed = true;
    void transcriptStore.close().then(() => {
      if (transcriptStore.turnCount > 0) {
        console.log(
          `[xai-relay] transcript saved (${transcriptStore.turnCount} turns) → ${transcriptStore.path}`,
        );
      }
    });
  };

  // Helper: send to browser safely
  const sendToBrowser = (data: string): void => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data);
    }
  };

  const sendRelayError = (code: string, message: string, detail?: string): void => {
    sendToBrowser(
      JSON.stringify({
        type: "error",
        error: {
          code,
          message,
          ...(detail ? { detail } : {}),
        },
      }),
    );
  };

  // In Node's `ws` a WebSocket is an EventEmitter, and an 'error' event with no
  // registered listener THROWS ("Unhandled error event"), which becomes an
  // uncaught exception that takes down the whole shared Next.js server — not
  // just voice. Abrupt client drops (ECONNRESET, killed tab, network blip)
  // routinely make the per-connection socket emit 'error', and the relay's own
  // design treats abrupt drops as normal (the reconnect-resume window). Attach a
  // listener for the socket's whole lifetime that logs and closes the upstream
  // if it's already open; the existing browserWs 'close' handler still runs
  // afterwards and owns transcript/session lifecycle. `upstream` is hoisted
  // below and may be undefined during the await-open window, so guard it.
  browserWs.on("error", (err) => {
    console.error("[xai-relay] browser socket error:", err);
    if (upstream && upstream.readyState === WebSocket.OPEN) upstream.close();
  });

  // Build system prompt
  let systemPrompt = "";
  try {
    systemPrompt = await buildSystemPrompt(safeBriefSlug);
  } catch (e) {
    console.error("[xai-relay] Failed to build system prompt:", e);
    systemPrompt = "You are an AI interviewer. Please begin the interview.";
  }

  // ── Stub mode ─────────────────────────────────────────────────────────────
  if (config.mode === "stub") {
    console.log("[xai-relay] STUB MODE — echoing scripted frames");
    // Send stub frames with delays to simulate real flow
    let delay = 100;
    for (const frame of stubFrames()) {
      setTimeout(() => {
        sendToBrowser(frame);
        transcriptStore.ingestFrame(frame, "upstream");
      }, delay);
      delay += 300;
    }
    browserWs.on("close", () => {
      console.log("[xai-relay] browser disconnected (stub)");
      sessions.delete(safeBriefSlug);
      closeTranscript();
    });
    return;
  }

  // ── Real mode ─────────────────────────────────────────────────────────────
  if (!config.apiKey) {
    sendRelayError(
      "missing_xai_api_key",
      "Voice interview relay is not configured. Set XAI_API_KEY on the web server or use ROBIN_XAI_MODE=stub for local testing.",
    );
    browserWs.close();
    return;
  }

  const upstreamUrl = `${config.realtimeUrl}?model=${encodeURIComponent(config.model)}`;
  console.log(`[xai-relay] connecting to ${upstreamUrl}`);

  let upstream: WebSocket;
  try {
    upstream = new WebSocket(upstreamUrl, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
  } catch (e) {
    sendRelayError(
      "relay_upstream_create_failed",
      "Could not create the xAI Realtime websocket connection.",
      String(e),
    );
    browserWs.close();
    return;
  }

  // Wait for upstream to open
  const upstreamOpened = await new Promise<boolean>((resolve) => {
    const onOpen = () => {
      upstream.off("error", onError);
      resolve(true);
    };
    const onError = (err: Error) => {
      upstream.off("open", onOpen);
      sendRelayError(
        "relay_upstream_connect_failed",
        "Could not connect to xAI Realtime. Check XAI_API_KEY, INTERVIEW_MODEL, and network access from the web server.",
        String(err),
      );
      browserWs.close();
      resolve(false);
    };
    upstream.once("open", onOpen);
    upstream.once("error", onError);
  });

  if (!upstreamOpened) {
    return;
  }

  console.log("[xai-relay] upstream connected, sending session.update");

  // Inject session config
  upstream.send(JSON.stringify(buildSessionUpdate(systemPrompt, config)));

  if (isResume && session.turns.length > 0) {
    // Reconnect: the new upstream session has no memory of the conversation so
    // far. Replay prior turns as conversation items to restore context, then
    // stay quiet — server-VAD picks the interview back up when the user speaks.
    // We deliberately do NOT send response.create here, so the model neither
    // re-greets nor immediately monologues over the replayed history.
    const replay = session.turns.slice(-MAX_REPLAY_TURNS);
    console.log(`[xai-relay] resuming session (replaying ${replay.length} turns)`);
    for (const turn of replay) {
      upstream.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: turn.role,
            content: [
              {
                // xAI/OpenAI realtime: user history uses input_text, assistant text.
                type: turn.role === "user" ? "input_text" : "text",
                text: turn.text,
              },
            ],
          },
        }),
      );
    }
  } else {
    // Fresh interview: have the model greet and ask the first question before
    // the user speaks. With server-VAD turn detection the assistant would
    // otherwise wait for user audio and stay silent — but the brief expects the
    // interviewer to lead, so we request an opening turn explicitly.
    upstream.send(JSON.stringify({ type: "response.create" }));
  }

  // ── Browser → upstream ───────────────────────────────────────────────────
  // The browser only ever sends JSON control events (input_audio_buffer.append,
  // etc.) as TEXT frames. Node's `ws` hands them to us as Buffers, and
  // upstream.send(Buffer) would re-emit them as BINARY frames — which xAI
  // Realtime silently ignores, so the user's audio never registers. Forward
  // text frames as strings to preserve framing; pass binary through untouched.
  browserWs.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      upstream.send(data);
    } else {
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString("utf-8")
        : data.toString("utf-8");
      upstream.send(text);
    }
  });

  browserWs.on("close", (code: number) => {
    // Distinguish a deliberate stop from a network drop. The browser's stop()
    // does a clean close (1000); "going away" (1001) is also intentional. Any
    // other code (or an abrupt drop) is a candidate reconnect: keep the session
    // record alive for RECONNECT_RESUME_WINDOW_MS and don't finalize the
    // transcript yet, so the resumed connection continues the same file.
    const deliberate = code === 1000 || code === 1001;
    console.log(`[xai-relay] browser closed (code=${code}), closing upstream`);
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
    if (deliberate) {
      sessions.delete(safeBriefSlug);
      closeTranscript();
    } else {
      session.disconnectedAt = Date.now();
      // Reap the record if no reconnect arrives within the window — finalize the
      // transcript then so a genuinely-abandoned session still gets saved.
      setTimeout(() => {
        if (session.disconnectedAt != null && sessions.get(safeBriefSlug) === session) {
          sessions.delete(safeBriefSlug);
          closeTranscript();
        }
      }, RECONNECT_RESUME_WINDOW_MS).unref?.();
    }
  });

  // Track whether a model response is currently in flight. We may only send
  // response.cancel (for barge-in) while one is active — cancelling when the
  // model is idle makes xAI emit a "no active response found" error, which the
  // browser would otherwise surface as a fatal error and end the interview.
  let responseActive = false;

  // ── Upstream → browser ───────────────────────────────────────────────────
  upstream.on("message", async (data: WebSocket.RawData) => {
    const raw = data instanceof Buffer ? data.toString("utf-8") : String(data);

    // Forward everything to browser first
    sendToBrowser(raw);

    // Capture for durable transcript (assistant turns + user transcriptions).
    transcriptStore.ingestFrame(raw, "upstream");

    // Then inspect for server-side handling
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const etype = event["type"] as string | undefined;

    if (etype === "response.created") {
      responseActive = true;
    } else if (
      etype === "response.done" ||
      etype === "response.cancelled" ||
      etype === "response.failed"
    ) {
      responseActive = false;
    }

    // Mirror committed turns for reconnect replay (same event set the transcript
    // store keys off, so the in-memory replay log matches the saved file).
    if (
      etype === "response.audio_transcript.done" ||
      etype === "response.output_audio_transcript.done" ||
      etype === "response.text.done" ||
      etype === "response.output_text.done"
    ) {
      const done = event["transcript"] ?? event["text"];
      if (typeof done === "string") recordTurn("assistant", done);
    } else if (etype === "conversation.item.input_audio_transcription.completed") {
      const userText = event["transcript"];
      if (typeof userText === "string") recordTurn("user", userText);
    }

    if (etype === "input_audio_buffer.speech_started") {
      // Barge-in: cancel an in-flight model response, but only if one is
      // actually active — otherwise xAI errors with "no active response found".
      if (responseActive && upstream.readyState === WebSocket.OPEN) {
        upstream.send(JSON.stringify({ type: "response.cancel" }));
        responseActive = false;
      }
    } else if (
      etype === "response.function_call_arguments.done" &&
      event["name"] === "search_background"
    ) {
      const callId = (event["call_id"] as string) ?? "";
      const argsRaw = (event["arguments"] as string) ?? "{}";
      let query = "";
      let k = 5;
      try {
        const args = JSON.parse(argsRaw) as { query?: string; k?: number };
        query = (args.query ?? "").trim();
        k = Math.max(1, Math.min(8, args.k ?? 5));
      } catch {
        // defaults
      }

      console.log(`[xai-relay] search_background(query=${JSON.stringify(query)}, k=${k})`);
      const output = await pageSearch(query, k);

      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output,
            },
          }),
        );
        upstream.send(JSON.stringify({ type: "response.create" }));
      }
    }
  });

  upstream.on("close", () => {
    console.log("[xai-relay] upstream closed");
    // If the upstream drops while the browser is still connected, close the
    // browser socket — the client will auto-reconnect, spawning a fresh relay
    // session that resumes this conversation (same transcript file + replayed
    // turns). The browser-`close` handler owns transcript/session lifecycle
    // (finalize on a clean stop, hold for the resume window on an abrupt drop),
    // so we don't finalize here and risk splitting a resumable transcript.
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.close();
    } else {
      // Browser already gone and not coming back via this socket — make sure a
      // transcript that was never finalized still lands (idempotent).
      if (session.disconnectedAt == null) closeTranscript();
    }
  });

  upstream.on("error", (err) => {
    console.error("[xai-relay] upstream error:", err);
    sendRelayError(
      "relay_upstream_error",
      "xAI Realtime websocket returned an error.",
      err.message,
    );
  });
}
