/**
 * meeting-keyterms.ts
 *
 * Builds the keyterm list fed to Deepgram Nova-3 "keyterm prompting" so the
 * live transcriber biases toward the proper nouns it would otherwise mangle:
 * teammate / stakeholder names and the org's product/project names.
 *
 * Source of truth is the brain itself (brain/people/**, brain/projects/*) so
 * the list stays current as the org changes — no hardcoded roster to maintain.
 * Extra org/product terms come from ROBIN_ORG_GLOSSARY (see lib/config).
 *
 * Server-only: reads the vault from disk.
 */

import fs from 'fs/promises';
import { vaultPath } from '@/lib/vault';
import { ORG_GLOSSARY as CONFIG_ORG_GLOSSARY } from '@/lib/config';

// Always-present terms + any adopter-supplied glossary (ROBIN_ORG_GLOSSARY).
// 'Robin' is the app's own name and stays regardless. Deduped on use.
const ORG_GLOSSARY = ['Robin', ...CONFIG_ORG_GLOSSARY];

// Deepgram caps keyterms per request; stay well under it and keep the
// highest-signal terms (names) first.
const MAX_KEYTERMS = 90;

/** Pull the <title> text out of a Robin HTML page. */
function extractTitle(html: string): string | null {
  const m = /<title>([^<]+)<\/title>/i.exec(html);
  return m?.[1]?.trim() || null;
}

async function readTitles(...dirSegments: string[]): Promise<string[]> {
  const dir = vaultPath(...dirSegments);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const titles: string[] = [];
  for (const file of entries) {
    // Skip index/overview pages and non-HTML.
    if (!file.endsWith('.html') || file.startsWith('_')) continue;
    try {
      const html = await fs.readFile(`${dir}/${file}`, 'utf-8');
      const title = extractTitle(html);
      if (title) titles.push(title);
    } catch {
      /* unreadable page — skip */
    }
  }
  return titles;
}

/**
 * Build the deduped keyterm list: full names + first names of everyone in
 * brain/people, then the org glossary. Returns [] if the brain is unreadable
 * (the recorder still works, just without name boosting).
 */
export async function buildMeetingKeyterms(): Promise<string[]> {
  const peopleTitles = [
    ...(await readTitles('brain', 'people', 'team')),
    ...(await readTitles('brain', 'people', 'stakeholders')),
  ];

  const terms = new Set<string>();
  for (const fullName of peopleTitles) {
    terms.add(fullName);
    // First name alone — people are usually addressed by it in meetings.
    const first = fullName.split(/\s+/)[0];
    if (first && first.length > 2) terms.add(first);
  }
  for (const term of ORG_GLOSSARY) terms.add(term);

  return Array.from(terms).slice(0, MAX_KEYTERMS);
}
