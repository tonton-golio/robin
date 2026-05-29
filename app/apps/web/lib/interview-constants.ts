/**
 * Pure constants and helpers for the interview tool.
 * This file MUST stay free of Node.js builtins (fs, path, etc.) and native modules
 * so it can be safely imported from client components.
 */

export const QUICK_INTERVIEW_SLUG = "__quick";

const DEFAULT_BRIEF_SLUG = "default";
const MAX_BRIEF_SLUG_LENGTH = 160;

/**
 * Sanitize a user-supplied string into a safe slug for filenames and URLs.
 * Pure function — safe for client and server.
 */
export function safeInterviewSlug(
  value: string | null | undefined,
  fallback = DEFAULT_BRIEF_SLUG,
): string {
  const safeFallback = fallback.trim() || DEFAULT_BRIEF_SLUG;
  const slug = (value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_BRIEF_SLUG_LENGTH)
    .replace(/-$/g, "");

  return slug || safeFallback;
}
