import { NextRequest, NextResponse } from "next/server";
import { safeInterviewSlug } from "@/lib/build-system-prompt";
import { getInterviewRuntimeConfig } from "@/lib/xai-relay";
import { mintSessionToken } from "@/lib/interview-session-token";

/**
 * GET /api/interview/voice?brief=<slug>
 *
 * Returns the WebSocket URL for the voice relay, including a short-lived signed
 * session token. The actual WS server runs on port 8401 (started via
 * instrumentation.ts).
 *
 * Why a separate port?
 * Next.js 16's built-in web server does not forward HTTP upgrade events to
 * App Router route handlers. We boot a standalone `ws` server in
 * instrumentation.ts on :8401 and point the browser there.
 *
 * Why a token? The relay port has no same-origin protection. This route runs
 * server-side and is reachable only same-origin via the app, so it can safely
 * mint a token the relay then requires — gating unauthenticated session
 * spawning. See lib/interview-session-token.ts.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const brief = safeInterviewSlug(searchParams.get("brief"));
  const config = getInterviewRuntimeConfig();

  // Derive the WS host from the request URL so it works in dev and prod
  const reqUrl = new URL(req.url);
  const wsHost = reqUrl.hostname;
  const wsProto = reqUrl.protocol === "https:" ? "wss" : "ws";

  const token = mintSessionToken(brief);
  const wsUrl = `${wsProto}://${wsHost}:${config.wsPort}/ws/voice?brief=${encodeURIComponent(brief)}&token=${encodeURIComponent(token)}`;

  return NextResponse.json({
    wsUrl,
    brief,
    mode: config.mode,
    model: config.model,
    voice: config.voice,
    ready: config.mode === "stub" || Boolean(config.apiKey),
    error:
      config.mode === "real" && !config.apiKey
        ? {
            code: "missing_xai_api_key",
            message:
              "Voice interview relay is not configured. Set XAI_API_KEY on the web server or use ROBIN_XAI_MODE=stub for local testing.",
          }
        : null,
  });
}
