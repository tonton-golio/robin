/**
 * Owner / org identity configuration.
 *
 * Server-side only. Reads the adopter's identity from environment variables so
 * the app ships generic out of the box and the owner personalizes it purely via
 * env — no hardcoded names in runtime source.
 *
 *   ROBIN_OWNER         e.g. "Alex" — the human this brain belongs to
 *   ROBIN_ORG           e.g. "Acme" — the org/company (optional)
 *   ROBIN_ORG_GLOSSARY  comma-separated proper nouns to bias transcription
 *                       (product names, project codenames, etc.)
 *
 * For client components, use NEXT_PUBLIC_ROBIN_OWNER directly (this module pulls
 * in server-only env and must not be imported into the client bundle).
 */

export const OWNER_NAME = (process.env.ROBIN_OWNER ?? '').trim();
export const ORG_NAME = (process.env.ROBIN_ORG ?? '').trim();
export const ORG_GLOSSARY = (process.env.ROBIN_ORG_GLOSSARY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Display label for the owner; falls back to a generic "You". */
export const ownerLabel = OWNER_NAME || 'You';

/** Lowercase subject pronoun for prose: "Alex" / "you". */
export const ownerSubject = OWNER_NAME || 'you';

/** Possessive form for prose: "Alex's" / "your". */
export function ownerPossessive(): string {
  return OWNER_NAME ? `${OWNER_NAME}'s` : 'your';
}

/**
 * Greeting helper. With an owner set:  greet('Good morning') -> "Good morning, Alex."
 * Without:                            greet('Good morning') -> "Good morning."
 */
export function greet(part: string): string {
  return OWNER_NAME ? `${part}, ${OWNER_NAME}.` : `${part}.`;
}

/**
 * "your AI partner and second brain" or "...and second brain at <org>" when an
 * org name is configured.
 */
export function partnerDescriptor(): string {
  return ORG_NAME
    ? `your AI partner and second brain at ${ORG_NAME}`
    : 'your AI partner and second brain';
}
