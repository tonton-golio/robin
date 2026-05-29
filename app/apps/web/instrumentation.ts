/**
 * Next.js Instrumentation hook.
 * Starts the voice relay WebSocket server on a dedicated port (default :8401)
 * because Next.js 16's HTTP server does not upgrade connections to route handlers.
 *
 * The WS server accepts connections at ws://localhost:8401/ws/voice?brief=<slug>
 * and delegates to xai-relay.ts.
 */

export async function register() {
  // Only run on the Node.js runtime (not Edge)
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    // Lazy import to avoid bundling ws into Edge runtime
    const { startVoiceRelayServer } = await import("./lib/voice-relay-server");
    startVoiceRelayServer();
  }
}
