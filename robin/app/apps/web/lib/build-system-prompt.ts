/**
 * Builds the system prompt for the xAI voice interviewer.
 *
 * Ports the logic from interviewer_voice2voice/backend/app/brief.py.
 * The brief HTML file is parsed via parseRobinHtml(); its bodyText becomes
 * the interview brief body.
 */

import fs from "fs/promises";
import path from "path";
import { vaultPath } from "./vault";

// Import pure constants/helpers from the client-safe module (single source of
// truth — avoids pulling Node builtins into client bundles). Re-exported so
// existing importers of this server module keep working.
import { QUICK_INTERVIEW_SLUG, safeInterviewSlug } from "./interview-constants";
import { ownerLabel, ownerPossessive, partnerDescriptor } from "./config";

export { safeInterviewSlug } from "./interview-constants";

const OWNER = ownerLabel; // configured owner display name, or "You" when unset
const OWNER_POSS = ownerPossessive(); // configured owner possessive, or "your" when unset

const PERSONA = `You are Robin, ${partnerDescriptor()}. Right now you're running a voice interview with ${OWNER} to draw out ${OWNER_POSS} current thinking.

Personality: direct, dry, fast. Warm but never soft or fawning. Concise by default — lead with the question, no filler. Keep every spoken turn to one or two sentences, never more than three, so ${OWNER} can jump in. Ask one focused question at a time, listen, and probe for specifics when an answer is vague. Push back when the reasoning is thin — you're allowed to say "that doesn't add up" or "why?". You don't lecture, monologue, or share long opinions; your job is to surface ${OWNER_POSS} perspective, decisions, and open questions.

Open with a single brief greeting plus your first question in one short turn — no preamble.

You have a \`search_background\` tool that reads ${OWNER_POSS} knowledge base — the brain: roadmap, decisions, people, budgets, risks, team status, meeting notes. Use it liberally: whenever a person, project, number, decision, or status comes up, call \`search_background\` to ground your next question in the real context instead of asking something generic. Quote specifics back when it sharpens the question.`;

/**
 * Read and extract the body text from a Robin HTML brief file.
 * Falls back to raw HTML text-strip if parseRobinHtml is unavailable.
 */
async function loadBriefText(briefPath: string): Promise<string> {
  const html = await fs.readFile(briefPath, "utf-8");
  try {
    // Dynamic import so this module can be imported without the indexer being present
    const { parseRobinHtml } = await import("@robin/indexer" as string);
    const parsed = parseRobinHtml(html);
    return parsed.bodyText.trim() || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  } catch {
    // Fallback: naive tag strip
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

export interface BriefEntry {
  slug: string;
  title: string;
  filename: string;
  absPath: string;
}

/**
 * List all HTML brief files from logs/briefs/.
 */
export async function listBriefs(): Promise<BriefEntry[]> {
  const briefsDir = vaultPath("logs", "briefs");
  let files: string[];
  try {
    files = await fs.readdir(briefsDir);
  } catch {
    return [];
  }

  const entries: BriefEntry[] = [];
  for (const f of files) {
    if (!f.endsWith(".html")) continue;
    const absPath = path.join(briefsDir, f);
    const slug = safeInterviewSlug(f.replace(/\.html$/, ""));
    // Try to extract title from HTML <title> or robin:title meta
    let title = slug;
    try {
      const html = await fs.readFile(absPath, "utf-8");
      const titleMatch = /<title>([^<]+)<\/title>/i.exec(html);
      if (titleMatch?.[1]) title = titleMatch[1].trim();
      else {
        const metaMatch = /robin:title"[^>]*content="([^"]+)"/i.exec(html);
        if (metaMatch?.[1]) title = metaMatch[1].trim();
      }
    } catch {
      // keep slug as title
    }
    entries.push({ slug, title, filename: f, absPath });
  }

  // Sort newest first
  entries.sort((a, b) => b.slug.localeCompare(a.slug));
  return entries;
}

/**
 * Build the full system prompt for the voice session.
 * briefSlug: e.g. "2026-05-26-board-deck-prep-interview"
 */
export async function buildSystemPrompt(briefSlug: string): Promise<string> {
  // Quick Interview mode: rich default prompt with full brain access, no file
  // required. Checked on the RAW slug before sanitization, since the "__quick"
  // sentinel sanitizes to "quick".
  if (briefSlug === QUICK_INTERVIEW_SLUG || briefSlug === "quick") {
    const quickPrompt = [
      PERSONA,
      `This is a **Quick Interview** with no pre-written brief. Your goal is to help ${OWNER} surface ${OWNER_POSS} current thinking, priorities, open questions, risks, and decisions across ${OWNER_POSS} work.`,
      `Start by calling \`search_background\` to orient yourself on what's currently live (roadmap, recent decisions, team status, risks, budgets) before your first question — then keep pulling real details whenever something comes up that you don't have fresh context for.`,
      `Ask focused, one-at-a-time questions. Push for concrete details, timelines, owners, and trade-offs. Keep turns short.`,
      `When the conversation reaches a natural stopping point, give a tight summary of the key signals you heard and offer to go deeper on any thread.`,
    ];
    return quickPrompt.join("\n\n");
  }

  const safeSlug = safeInterviewSlug(briefSlug);
  const briefsDir = vaultPath("logs", "briefs");
  const briefPath = path.join(briefsDir, `${safeSlug}.html`);

  let briefBody = "(no brief found)";
  try {
    briefBody = await loadBriefText(briefPath);
  } catch {
    // leave default
  }

  const parts: string[] = [
    PERSONA,
    `# Interview Brief\n\n${briefBody}`,
    `You have a \`search_background\` tool — use it sparingly to recall specifics about people, projects, or recent decisions.`,
  ];

  return parts.join("\n\n");
}
