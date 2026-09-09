/**
 * Origin allowlist for the voice-interview WebSocket relay.
 *
 * The relay is a raw `ws` server, so it must enforce its own Origin check
 * (browsers attach Origin to WS handshakes; a same-origin app page will send
 * the app's own origin). We allow localhost / 127.0.0.1 on any port (the dev
 * and prod web servers, plus the relay's own port) and anything explicitly
 * configured for an authenticated remote deployment.
 *
 * Requests with NO Origin header (e.g. non-browser clients) are rejected — a
 * legitimate browser session always carries one.
 */

import { configuredRemoteOrigin } from "./runtime-security";

function parseExtraOrigins(env: NodeJS.ProcessEnv): Set<string> {
  const raw = env["INTERVIEW_ALLOWED_ORIGINS"]?.trim();
  const configured = raw
    ? raw
        .split(",")
        .map((o) => o.trim().replace(/\/$/, ""))
        .filter(Boolean)
    : [];
  const publicOrigin = configuredRemoteOrigin(env);
  if (publicOrigin) configured.push(publicOrigin);
  return new Set(configured);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Decide whether a handshake Origin is allowed.
 * @param origin the raw `Origin` header value from the WS upgrade request
 */
export function isOriginAllowed(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!origin) return false;

  const extras = parseExtraOrigins(env);
  const normalized = origin.replace(/\/$/, "");
  if (extras.has(normalized)) return true;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return LOCAL_HOSTS.has(url.hostname);
}
