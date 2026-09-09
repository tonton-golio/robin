import fs from 'node:fs/promises';
import path from 'node:path';
import { parseRobinHtmlCore } from '@robin/converter';
import { locateVault } from './vault';
import { vaultPageHref } from './routes';
import { isArchivePath } from './archive';
import { loadFollowThrough, type FollowThroughSnapshot } from './follow-through';

/** Explicit canonical fields only. File modification time is never evidence time. */
export interface OverviewPage {
  path: string;
  title: string;
  meta: Record<string, string[]>;
}
export interface OverviewItem {
  path: string;
  href: string;
  title: string;
  summary?: string;
  state?: string;
  owner?: string;
  checkpoint?: string;
  nextAction?: string;
  sourceDate?: string;
  pageUpdatedAt?: string;
  sources: string[];
  reviewReasons?: string[];
}
export interface CurrentOverview {
  generatedAt: string;
  followThrough: FollowThroughSnapshot;
  outcomes: OverviewItem[];
  nextActions: OverviewItem[];
  needsUser: OverviewItem[];
  relevantChanges: OverviewItem[];
  sourceCoverage: {
    status: 'local-records-only';
    externalCoverage: 'unknown';
    note: string;
    records: number;
    datedRecords: number;
    latestRecordDate?: string;
    latest: OverviewItem[];
  };
  totals: { outcomes: number; nextActions: number; needsUser: number };
  taskHygiene: { overdue: number; missingNextAction: number; blocked: number; backlog: number };
  unreadablePaths: string[];
}

const field = (p: OverviewPage, key: string) => p.meta[`robin:${key}`]?.[0];
const state = (p: OverviewPage) => (field(p, 'status') ?? field(p, 'state') ?? '').toLowerCase().replaceAll('_', '-');
const active = (p: OverviewPage) => ['open', 'active', 'in-progress', 'blocked', 'pending', 'planned'].includes(state(p));
const date = (value?: string) => value && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
const timestamp = (value?: string) => value ? Date.parse(value) : 0;
const clip = (value?: string) => value?.slice(0, 400);

function sourceRefs(p: OverviewPage): string[] {
  return [...new Set(['source', 'source-ref', 'source_ref', 'source_refs'].flatMap((key) => (p.meta[`robin:${key}`] ?? []).flatMap((value) => {
    // Some task writers store one JSON-array metadata value.
    try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string'); } catch { /* plain source */ }
    return [value];
  })))].slice(0, 6);
}

function item(p: OverviewPage): OverviewItem {
  return {
    path: p.path, href: vaultPageHref(p.path), title: p.title,
    summary: clip(field(p, 'summary')), state: state(p) || undefined,
    owner: clip(field(p, 'owner')), checkpoint: date(field(p, 'due')),
    nextAction: clip(field(p, 'next_action') ?? field(p, 'recommended-action')),
    sourceDate: date(field(p, 'date')), pageUpdatedAt: date(field(p, 'updated')),
    sources: sourceRefs(p),
  };
}

function rankTasks(a: OverviewPage, b: OverviewPage): number {
  const priority = (p: OverviewPage) => /^p[0-3]$/i.test(field(p, 'priority') ?? '') ? Number(field(p, 'priority')!.slice(1)) : 4;
  return priority(a) - priority(b)
    || (timestamp(date(field(a, 'due'))) || Infinity) - (timestamp(date(field(b, 'due'))) || Infinity)
    || a.path.localeCompare(b.path);
}

/** Deterministic, bounded derivation; nothing is persisted or marked reviewed. */
export function deriveOverview(pages: OverviewPage[], now = new Date(), unreadablePaths: string[] = [], followThrough: FollowThroughSnapshot = { watching: [], changes: [], historyAvailable: false }): CurrentOverview {
  pages = pages.filter(p => !isArchivePath(p.path) && state(p) !== 'archived');
  const tasks = pages.filter((p) => field(p, 'type') === 'task' && active(p)).sort(rankTasks);
  const outcomes = tasks.filter((p) => field(p, 'kind') === 'outcome');
  const actions = tasks.filter((p) => !['outcome', 'workstream'].includes(field(p, 'kind') ?? 'task'));
  const interventions = pages.filter((p) => field(p, 'type') === 'intervention' && state(p) === 'open')
    .sort((a, b) => a.path.localeCompare(b.path));
  const day = now.toISOString().slice(0, 10);
  const backlog = (p: OverviewPage) => field(p, 'priority')?.toLowerCase() === 'p3';
  const overdue = (p: OverviewPage) => Boolean(date(field(p, 'due')) && field(p, 'due')!.slice(0, 10) < day);
  const reasons = (p: OverviewPage) => [
    ...(overdue(p) ? ['Recorded checkpoint has passed; verify current status'] : []),
    ...(state(p) === 'blocked' ? ['Blocked; clarify the next intervention'] : []),
    ...(!['outcome', 'workstream'].includes(field(p, 'kind') ?? '') && !field(p, 'next_action') ? ['Next action needs clarification'] : []),
  ];
  const needsUser = [...interventions.map(item), ...tasks.filter(p => !backlog(p) && reasons(p).length).map(p => ({ ...item(p), reviewReasons: reasons(p) }))];
  // A task needing clarification belongs in review, not in both visible lanes.
  // Preserve its recorded next action on the review item until that trigger clears.
  const visibleActions = actions.filter(p => !backlog(p) && Boolean(field(p, 'next_action')) && reasons(p).length === 0);
  const records = pages.filter((p) => /^(logs\/meetings|logs\/reports)\//.test(p.path));
  const dated = records.filter((p) => date(field(p, 'date')))
    .sort((a, b) => timestamp(field(b, 'date')) - timestamp(field(a, 'date')) || a.path.localeCompare(b.path));
  const changes = pages.filter((p) => ['decision', 'project', 'person', 'knowledge', 'meeting', 'report'].includes(field(p, 'type') ?? '') && !p.meta['robin:tag']?.includes('thought') && date(field(p, 'updated')))
    .sort((a, b) => timestamp(field(b, 'updated')) - timestamp(field(a, 'updated')) || a.path.localeCompare(b.path));
  return {
    followThrough,
    generatedAt: now.toISOString(), outcomes: outcomes.slice(0, 5).map(item), nextActions: visibleActions.slice(0, 6).map(item),
    needsUser: needsUser.slice(0, 5), relevantChanges: changes.slice(0, 4).map(item),
    sourceCoverage: {
      status: 'local-records-only', externalCoverage: 'unknown',
      note: 'Dates describe retained meeting/report records, not complete external-service coverage. Page updates are not new source observations.',
      records: records.length, datedRecords: dated.length, latestRecordDate: dated[0] ? field(dated[0], 'date') : undefined,
      latest: dated.slice(0, 3).map(item),
    },
    totals: { outcomes: outcomes.length, nextActions: visibleActions.length, needsUser: needsUser.length },
    taskHygiene: { overdue: actions.filter(overdue).length, missingNextAction: actions.filter(p => !field(p, "next_action")).length, blocked: actions.filter(p => state(p) === "blocked").length, backlog: actions.filter(backlog).length },
    unreadablePaths: unreadablePaths.slice(0, 20),
  };
}

export async function readOverviewPages(vault: string, roots = ['brain', 'logs/meetings', 'logs/reports']): Promise<{ pages: OverviewPage[]; unreadablePaths: string[] }> {
  const files: string[] = [];
  const unreadablePaths: string[] = [];
  async function walk(rel: string) {
    let entries;
    try { entries = await fs.readdir(path.join(vault, rel), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadablePaths.push(rel); return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ['archive', 'archives', 'archived', 'trash', 'node_modules'].includes(entry.name.toLowerCase())) continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && entry.name.endsWith('.html')) files.push(child);
    }
  }
  await Promise.all(roots.map(walk));
  const pages = await Promise.all(files.sort().map(async (rel): Promise<OverviewPage | null> => {
    try {
      const parsed = parseRobinHtmlCore(await fs.readFile(path.join(vault, rel), 'utf8'));
      return { path: rel, title: parsed.title || path.basename(rel, '.html'), meta: parsed.metaMap };
    } catch { unreadablePaths.push(rel); return null; }
  }));
  return { pages: pages.filter((p): p is OverviewPage => p !== null), unreadablePaths: unreadablePaths.sort() };
}

export async function loadOverview(vault = locateVault(), now = new Date()): Promise<CurrentOverview> {
  const [{ pages, unreadablePaths }, followThrough] = await Promise.all([
    readOverviewPages(vault),
    loadFollowThrough(vault, now),
  ]);
  return deriveOverview(pages, now, unreadablePaths, followThrough);
}

export function selectThoughts(pages: OverviewPage[]) {
  return pages.filter((p) => !isArchivePath(p.path) && field(p, 'type') === 'knowledge' && p.meta['robin:tag']?.includes('thought') && state(p) === 'needs-review')
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((p) => ({ ...item(p), author: field(p, 'author'), reviewTrigger: field(p, 'review_trigger') }));
}
