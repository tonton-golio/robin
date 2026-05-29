/**
 * Short-lived session tokens for the voice-interview relay.
 *
 * The voice relay (lib/voice-relay-server.ts) is a raw `ws` server on a
 * dedicated port — it does NOT sit behind Next's same-origin protections, so
 * without a check anything on the machine could open an interview session
 * (which spends xAI Realtime credits and reads the brain). To gate it we mint a
 * short-lived signed token from a same-origin GET route the browser hits first
 * (app/api/interview/voice), then require that token as a query param when the
 * browser opens the WebSocket. The relay validates it before bridging.
 *
 * Security model: this is a single-user *local* tool. The token is an HMAC over
 * `brief:expiry:nonce` with a per-process secret. Both the API route and the
 * relay run in the SAME Node process (the relay is booted from
 * instrumentation.ts), so they share this module's in-memory secret with no
 * external key distribution. A fresh secret per process means tokens minted by
 * one server lifetime are useless to another — fine for a local tool, and it
 * keeps replay windows tied to a single run.
 *
 * A stable secret can be pinned via INTERVIEW_SESSION_SECRET if a deployment
 * ever splits the route and relay into separate processes.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** How long a minted token stays valid. Long enough to allow a reconnect. */
const TOKEN_TTL_MS = 5 * 60 * 1000;

let _secret: Buffer | null = null;

function getSecret(): Buffer {
  if (_secret) return _secret;
  const pinned = process.env["INTERVIEW_SESSION_SECRET"]?.trim();
  _secret = pinned ? Buffer.from(pinned, "utf-8") : randomBytes(32);
  return _secret;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payload: string): string {
  return base64url(createHmac("sha256", getSecret()).update(payload).digest());
}

/**
 * Mint a token bound to a brief slug, valid for TOKEN_TTL_MS.
 * Format: <base64url(brief:expiry:nonce)>.<base64url(hmac)>
 */
export function mintSessionToken(briefSlug: string): string {
  const expiry = Date.now() + TOKEN_TTL_MS;
  const nonce = base64url(randomBytes(9));
  const payload = `${briefSlug}:${expiry}:${nonce}`;
  const body = base64url(Buffer.from(payload, "utf-8"));
  return `${body}.${sign(payload)}`;
}

export interface TokenVerification {
  ok: boolean;
  reason?: string;
  briefSlug?: string;
}

/**
 * Verify a token and that it was minted for `expectedBrief`.
 * Constant-time signature comparison; rejects malformed / expired / mismatched.
 */
export function verifySessionToken(token: string | null | undefined, expectedBrief: string): TokenVerification {
  if (!token) return { ok: false, reason: "missing_token" };

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed_token" };

  const body = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  } catch {
    return { ok: false, reason: "malformed_token" };
  }

  const expectedSig = sign(payload);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  const parts = payload.split(":");
  if (parts.length !== 3) return { ok: false, reason: "malformed_payload" };
  const [briefSlug, expiryRaw] = parts;
  const expiry = Number.parseInt(expiryRaw ?? "", 10);
  if (!Number.isFinite(expiry) || Date.now() > expiry) {
    return { ok: false, reason: "expired" };
  }
  if (briefSlug !== expectedBrief) {
    return { ok: false, reason: "brief_mismatch" };
  }

  return { ok: true, briefSlug };
}
