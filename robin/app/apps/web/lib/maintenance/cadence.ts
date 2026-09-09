import path from 'path';
import { locateVault } from '@/lib/vault';
import { ageDays, readJsonlFile, readText } from './shared';

export interface CadenceSection {
  title: string;
  changelog: LogCadence;
  ingestLog: LogCadence;
  editLogMonth: string;
  editLogVolume: number;
}

export interface LogCadence {
  source: string;
  lastEntry: string | null;
  daysSince: number | null;
}

// Days since the most recent `## [YYYY-MM-DD]` header in a MD log, plus the
// edit-log line volume for the current month.
export async function getCadenceSection(generatedAt: string): Promise<CadenceSection> {
  const now = new Date(generatedAt);

  const [changelog, ingestLog] = await Promise.all([
    logCadence('logs/changelog.md', now),
    logCadence('logs/ingest-log.md', now),
  ]);

  const month = generatedAt.slice(0, 7); // YYYY-MM
  const editRel = path.join('inbox', 'robin', 'edits', `${month}.jsonl`);
  const edits = await readJsonlFile(editRel);

  return {
    title: 'Operational cadence',
    changelog,
    ingestLog,
    editLogMonth: month,
    editLogVolume: edits.totalLines,
  };
}

async function logCadence(relPath: string, now: Date): Promise<LogCadence> {
  const text = await readText(path.join(locateVault(), relPath));
  const lastEntry = latestHeaderDate(text);
  return {
    source: relPath,
    lastEntry,
    daysSince: lastEntry ? ageDays(lastEntry, now) : null,
  };
}

// Parse every `## [YYYY-MM-DD] ...` header and return the max date. Files are
// conventionally newest-first, but we scan all headers to be robust.
function latestHeaderDate(text: string): string | null {
  let latest: string | null = null;
  const re = /^##\s*\[(\d{4}-\d{2}-\d{2})\]/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const date = match[1];
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest;
}
