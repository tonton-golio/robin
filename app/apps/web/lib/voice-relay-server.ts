/**
 * Boots a standalone WebSocket server for the voice relay.
 * Called once from instrumentation.ts on the Node.js runtime.
 *
 * Listens on INTERVIEW_WS_PORT (default 8401).
 * Accepts: ws://localhost:8401/ws/voice?brief=<slug>&token=<session-token>
 *
 * Hardening:
 *   - verifyClient enforces a strict Origin allowlist (localhost + configured
 *     origins) before the upgrade completes.
 *   - Each connection must carry a short-lived session token minted by the
 *     same-origin GET /api/interview/voice route (see interview-session-token).
 *   - ws ping/pong heartbeat terminates sockets that stop responding.
 *   - Startup is idempotent and survives Next dev reloads; EADDRINUSE triggers
 *     a bounded bind-retry; process-exit hooks tear the server down.
 */

import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import type { IncomingMessage } from "node:http";
import { handleRelayConnection, getInterviewRuntimeConfig } from "./xai-relay";
import { isOriginAllowed } from "./interview-origin";
import { verifySessionToken } from "./interview-session-token";
import { safeInterviewSlug } from "./interview-constants";

// Heartbeat: ping every interval; a socket that misses a pong by the next tick
// is considered dead and terminated (frees the upstream xAI socket too).
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_BIND_RETRIES = 5;
const BIND_RETRY_DELAY_MS = 750;

type LiveSocket = WebSocket & { isAlive?: boolean };

// Persist across Next dev hot-reloads. The instrumentation module can be
// re-evaluated; a plain module-level boolean would reset and double-bind. A
// globalThis handle makes startup truly idempotent and lets us tear the old
// server down before a fresh bind.
interface RelayHandle {
  wss: WebSocketServer | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  starting: boolean;
  cleanupRegistered: boolean;
}

const GLOBAL_KEY = "__robinVoiceRelay__";
function handle(): RelayHandle {
  const g = globalThis as unknown as Record<string, RelayHandle | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { wss: null, heartbeat: null, starting: false, cleanupRegistered: false };
  }
  return g[GLOBAL_KEY] as RelayHandle;
}

function rejectUpgrade(socket: NodeJS.WritableStream & { destroy?: () => void }, status: number, reason: string): void {
  try {
    (socket as unknown as { write?: (s: string) => void }).write?.(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  } catch {
    /* ignore */
  }
  socket.destroy?.();
}

function attachHeartbeat(h: RelayHandle, wss: WebSocketServer): void {
  if (h.heartbeat) clearInterval(h.heartbeat);
  h.heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as LiveSocket;
      if (ws.isAlive === false) {
        console.warn("[voice-relay] terminating unresponsive socket");
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  // Don't keep the process alive solely for the heartbeat.
  h.heartbeat.unref?.();
}

function bindServer(port: number, attempt: number): void {
  const h = handle();

  const wss = new WebSocketServer({
    port,
    // Reject disallowed origins before the handshake completes. Token validation
    // happens in the connection handler (we need the parsed URL there anyway).
    verifyClient: (info: { origin?: string; req: IncomingMessage }) => {
      const origin = info.origin ?? (info.req.headers.origin as string | undefined);
      if (!isOriginAllowed(origin)) {
        console.warn(`[voice-relay] rejected connection from origin=${origin ?? "<none>"}`);
        return false;
      }
      return true;
    },
  });
  h.wss = wss;

  wss.on("listening", () => {
    console.log(`[voice-relay] WS server listening on ws://localhost:${port}/ws/voice`);
  });

  wss.on("connection", (ws: LiveSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (!url.pathname.startsWith("/ws/voice")) {
      ws.close(1008, "Not found");
      return;
    }

    const brief = safeInterviewSlug(url.searchParams.get("brief"));

    // Require a valid, unexpired session token bound to this brief. This is the
    // gate that stops unauthenticated session spawning on the relay port.
    const token = url.searchParams.get("token");
    const verdict = verifySessionToken(token, brief);
    if (!verdict.ok) {
      console.warn(`[voice-relay] rejected connection: token ${verdict.reason}`);
      ws.close(4401, `Unauthorized: ${verdict.reason}`);
      return;
    }

    // Heartbeat bookkeeping.
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    console.log(`[voice-relay] browser connected, brief=${brief}`);

    handleRelayConnection(ws, brief).catch((err: unknown) => {
      console.error("[voice-relay] relay error:", err);
      if (ws.readyState === ws.OPEN) {
        ws.close(1011, "Internal error");
      }
    });
  });

  wss.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      h.wss = null;
      if (attempt < MAX_BIND_RETRIES) {
        console.warn(
          `[voice-relay] port ${port} in use, retry ${attempt + 1}/${MAX_BIND_RETRIES} in ${BIND_RETRY_DELAY_MS}ms`,
        );
        setTimeout(() => bindServer(port, attempt + 1), BIND_RETRY_DELAY_MS);
      } else {
        console.error(
          `[voice-relay] port ${port} still in use after ${MAX_BIND_RETRIES} retries; giving up. ` +
            `Set INTERVIEW_WS_PORT to a free port or stop the process holding it.`,
        );
        h.starting = false;
      }
      return;
    }
    console.error("[voice-relay] WS server error:", err);
  });

  attachHeartbeat(h, wss);
  h.starting = false;
}

function teardown(): void {
  const h = handle();
  if (h.heartbeat) {
    clearInterval(h.heartbeat);
    h.heartbeat = null;
  }
  if (h.wss) {
    for (const client of h.wss.clients) {
      try {
        client.terminate();
      } catch {
        /* ignore */
      }
    }
    h.wss.close();
    h.wss = null;
  }
}

export function startVoiceRelayServer(): void {
  const h = handle();
  // Idempotent: already listening or mid-bind → no-op.
  if (h.wss || h.starting) return;
  h.starting = true;

  const port = getInterviewRuntimeConfig().wsPort;

  if (!h.cleanupRegistered) {
    h.cleanupRegistered = true;
    // Tear the server down on process exit so a dev reload / restart doesn't
    // orphan a listener (which would otherwise cause EADDRINUSE on the next boot).
    process.once("SIGINT", () => {
      teardown();
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      teardown();
      process.exit(0);
    });
    process.once("beforeExit", teardown);
  }

  bindServer(port, 0);
}

/** Exposed for tests / explicit shutdown. */
export function stopVoiceRelayServer(): void {
  teardown();
}
