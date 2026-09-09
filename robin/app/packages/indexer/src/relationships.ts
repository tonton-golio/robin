import type Database from 'better-sqlite3';

const DEFAULT_TRAIL_LIMIT = 8;
const DEFAULT_SUGGESTION_LIMIT = 8;

const GENERIC_TITLE_WORDS = new Set([
  'about',
  'archive',
  'archives',
  'backlog',
  'draft',
  'home',
  'index',
  'inbox',
  'log',
  'logs',
  'misc',
  'notes',
  'overview',
  'page',
  'readme',
  'reference',
  'scratch',
  'tasks',
  'todo',
]);

export interface PageRef {
  path: string;
  slug: string;
  title: string;
  type: string;
}

export interface PageConnection {
  page: PageRef;
  kind: string;
  reason: string;
  score: number;
}

export interface ConnectionTrail {
  via: PageRef;
  target: PageRef;
  reason: string;
  score: number;
}

export interface LinkSuggestion {
  page: PageRef;
  matchedText: string;
  reason: string;
  score: number;
}

export interface PageConnections {
  page: PageRef;
  outbound: PageConnection[];
  backlinks: PageConnection[];
  trails: ConnectionTrail[];
  suggestions: LinkSuggestion[];
}

export interface PageConnectionOptions {
  trailLimit?: number;
  suggestionLimit?: number;
}

interface PageRow {
  path: string;
  slug: string;
  title: string | null;
  type: string;
  body_text?: string | null;
}

interface LinkPageRow extends PageRow {
  kind: string;
}

interface TrailRow {
  via_path: string;
  via_slug: string;
  via_title: string | null;
  via_type: string;
  target_path: string;
  target_slug: string;
  target_title: string | null;
  target_type: string;
  target_backlinks: number;
}

interface SuggestionCandidate extends PageRow {
  body_text: string | null;
}

export function getPageConnections(
  db: Database.Database,
  pagePath: string,
  opts: PageConnectionOptions = {}
): PageConnections | null {
  const current = resolvePage(db, pagePath);
  if (!current) return null;

  const page = pageRef(current);
  const outbound = getOutboundConnections(db, current);
  const backlinks = getBacklinkConnections(db, current);
  const directPaths = new Set(outbound.map((connection) => connection.page.path));
  const trails = getConnectionTrails(db, current, directPaths, limitOption(opts.trailLimit, DEFAULT_TRAIL_LIMIT));
  const suggestions = getLinkSuggestions(
    db,
    current,
    directPaths,
    limitOption(opts.suggestionLimit, DEFAULT_SUGGESTION_LIMIT)
  );

  return {
    page,
    outbound,
    backlinks,
    trails,
    suggestions,
  };
}

function resolvePage(db: Database.Database, pagePath: string): PageRow | null {
  const exact = db
    .prepare('SELECT path, slug, title, type, body_text FROM pages WHERE path = ?')
    .get(pagePath) as PageRow | undefined;
  if (exact) return exact;

  const resolvedSlug = db
    .prepare(
      `SELECT p.path, p.slug, p.title, p.type, p.body_text
       FROM wikilinks w
       JOIN pages p ON p.path = w.path
       WHERE w.slug = ?`
    )
    .get(pagePath) as PageRow | undefined;
  if (resolvedSlug) return resolvedSlug;

  return (
    (db
      .prepare(`SELECT path, slug, title, type, body_text
                  FROM pages
                 WHERE slug = ?
                 ORDER BY CASE
                   WHEN lower(path) LIKE 'archive/%'
                     OR lower(path) LIKE '%/archive/%'
                     OR lower(path) LIKE 'archives/%'
                     OR lower(path) LIKE '%/archives/%'
                     OR lower(path) LIKE 'archived/%'
                     OR lower(path) LIKE '%/archived/%'
                   THEN 1 ELSE 0 END,
                   path
                 LIMIT 1`)
      .get(pagePath) as PageRow | undefined) ?? null
  );
}

function getOutboundConnections(db: Database.Database, current: PageRow): PageConnection[] {
  const rows = db
    .prepare(
      `SELECT p.path, p.slug, p.title, p.type, l.kind
       FROM links l
       JOIN wikilinks w ON w.slug = l.to_slug
       JOIN pages p ON p.path = w.path
       WHERE l.from_path = ?
       ORDER BY COALESCE(p.title, p.slug), p.path`
    )
    .all(current.path) as LinkPageRow[];

  return uniqueByPagePath(rows, (row) => ({
    page: pageRef(row),
    kind: row.kind,
    reason: `Links to ${displayTitle(row)}`,
    score: 1,
  }));
}

function getBacklinkConnections(db: Database.Database, current: PageRow): PageConnection[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT p.path, p.slug, p.title, p.type, l.kind
       FROM links l
       JOIN pages p ON p.path = l.from_path
       WHERE l.to_slug = ?
       ORDER BY COALESCE(p.title, p.slug), p.path`
    )
    .all(current.slug) as LinkPageRow[];

  return uniqueByPagePath(rows, (row) => ({
    page: pageRef(row),
    kind: row.kind,
    reason: `${displayTitle(row)} links here`,
    score: 1,
  }));
}

function getConnectionTrails(
  db: Database.Database,
  current: PageRow,
  directPaths: Set<string>,
  limit: number
): ConnectionTrail[] {
  if (limit === 0) return [];

  const rows = db
    .prepare(
      `SELECT
         via.path AS via_path,
         via.slug AS via_slug,
         via.title AS via_title,
         via.type AS via_type,
         target.path AS target_path,
         target.slug AS target_slug,
         target.title AS target_title,
         target.type AS target_type,
         (
           SELECT COUNT(DISTINCT inbound.from_path)
           FROM links inbound
           WHERE inbound.to_slug = target.slug
         ) AS target_backlinks
       FROM links first_hop
       JOIN wikilinks via_link ON via_link.slug = first_hop.to_slug
       JOIN pages via ON via.path = via_link.path
       JOIN links second_hop ON second_hop.from_path = via.path
       JOIN wikilinks target_link ON target_link.slug = second_hop.to_slug
       JOIN pages target ON target.path = target_link.path
       WHERE first_hop.from_path = ?
       ORDER BY COALESCE(via.title, via.slug), via.path, COALESCE(target.title, target.slug), target.path`
    )
    .all(current.path) as TrailRow[];

  const byPath = new Map<string, ConnectionTrail>();
  for (const row of rows) {
    if (row.target_path === current.path) continue;
    if (directPaths.has(row.target_path)) continue;

    const key = `${row.via_path}\u0000${row.target_path}`;
    if (byPath.has(key)) continue;

    const via = pageRef({
      path: row.via_path,
      slug: row.via_slug,
      title: row.via_title,
      type: row.via_type,
    });
    const target = pageRef({
      path: row.target_path,
      slug: row.target_slug,
      title: row.target_title,
      type: row.target_type,
    });
    byPath.set(key, {
      via,
      target,
      reason: `Two-hop path through ${via.title}`,
      score: roundScore(0.7 + Math.min(0.2, row.target_backlinks * 0.03)),
    });
  }

  return [...byPath.values()]
    .sort(compareTrails)
    .slice(0, limit);
}

function getLinkSuggestions(
  db: Database.Database,
  current: PageRow,
  directPaths: Set<string>,
  limit: number
): LinkSuggestion[] {
  if (limit === 0) return [];

  const bodyText = current.body_text ?? '';
  if (!bodyText.trim()) return [];

  const linkedSlugs = new Set(
    (db.prepare('SELECT to_slug FROM links WHERE from_path = ?').all(current.path) as Array<{ to_slug: string }>)
      .map((row) => row.to_slug)
  );
  const candidates = db
    .prepare(
      `SELECT path, slug, title, type, body_text
       FROM pages
       WHERE path <> ?
       ORDER BY COALESCE(title, slug), path`
    )
    .all(current.path) as SuggestionCandidate[];

  const suggestions = new Map<string, LinkSuggestion>();
  for (const candidate of candidates) {
    if (directPaths.has(candidate.path)) continue;
    if (linkedSlugs.has(candidate.slug)) continue;
    if (isArchivePath(candidate.path)) continue;

    const titlePhrase = usablePhrase(candidate.title ?? '');
    const slugPhrase = usablePhrase(slugToPhrase(candidate.slug));
    const titleMatch = titlePhrase ? findPhrase(bodyText, titlePhrase) : null;
    const slugMatch = slugPhrase && slugPhrase !== titlePhrase ? findPhrase(bodyText, slugPhrase) : null;

    if (!titleMatch && !slugMatch) continue;

    const usesTitle = !!titleMatch;
    const match = titleMatch ?? slugMatch!;
    const score = usesTitle ? 0.95 : 0.78;
    const suggestion: LinkSuggestion = {
      page: pageRef(candidate),
      matchedText: match,
      reason: usesTitle ? 'Title mentioned without a wikilink' : 'Slug phrase mentioned without a wikilink',
      score,
    };

    const existing = suggestions.get(candidate.path);
    if (!existing || compareSuggestions(suggestion, existing) < 0) {
      suggestions.set(candidate.path, suggestion);
    }
  }

  return [...suggestions.values()]
    .sort(compareSuggestions)
    .slice(0, limit);
}

function uniqueByPagePath(
  rows: LinkPageRow[],
  mapRow: (row: LinkPageRow) => PageConnection
): PageConnection[] {
  const seen = new Set<string>();
  const connections: PageConnection[] = [];
  for (const row of rows) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    connections.push(mapRow(row));
  }
  return connections;
}

function pageRef(row: PageRow): PageRef {
  return {
    path: row.path,
    slug: row.slug,
    title: displayTitle(row),
    type: row.type,
  };
}

function displayTitle(row: Pick<PageRow, 'slug' | 'title'>): string {
  const title = row.title?.trim();
  return title || row.slug;
}

function limitOption(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.max(0, Math.floor(value));
}

function usablePhrase(phrase: string): string | null {
  const normalized = phrase.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  if (GENERIC_TITLE_WORDS.has(lower)) return null;
  if (normalized.length < 4) return null;

  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0]!.length < 6) return null;
  if (words.every((word) => GENERIC_TITLE_WORDS.has(word))) return null;

  return normalized;
}

function slugToPhrase(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isArchivePath(path: string): boolean {
  return /(?:^|\/)archives?(?:\/|$)/i.test(path);
}

function findPhrase(bodyText: string, phrase: string): string | null {
  const pattern = phrase
    .split(/\s+/)
    .map(escapeRegExp)
    .join('\\s+');
  const match = new RegExp(`(^|[^A-Za-z0-9])(${pattern})(?=$|[^A-Za-z0-9])`, 'i').exec(bodyText);
  return match?.[2] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function roundScore(score: number): number {
  return Math.round(score * 1000) / 1000;
}

function compareTrails(a: ConnectionTrail, b: ConnectionTrail): number {
  return b.score - a.score
    || a.via.title.localeCompare(b.via.title)
    || a.via.path.localeCompare(b.via.path)
    || a.target.title.localeCompare(b.target.title)
    || a.target.path.localeCompare(b.target.path);
}

function compareSuggestions(a: LinkSuggestion, b: LinkSuggestion): number {
  return b.score - a.score
    || a.matchedText.localeCompare(b.matchedText)
    || a.page.title.localeCompare(b.page.title)
    || a.page.path.localeCompare(b.page.path);
}
