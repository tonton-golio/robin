import type { RobinFrontmatter, RobinMeta } from './types.js';

const SPEC_VERSION = '0.2';

const KNOWN_KEYS = new Set([
  'type',
  'summary',
  'state',
  'status',
  'owner',
  'priority',
  'size',
  'due',
  'role',
  'relationship',
  'started',
  'updated',
  'created',
  'date',
  'duration',
  'tier',
  'tags',
  'attendees',
  'source',
  'sources',
  'title',
  'category', // common in current vault; mapped to tag for now
  'name',
  'aliases',
]);

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a date-ish value to ISO-8601 UTC.
 * Accepts: Date, string ISO date, string ISO datetime, naked YYYY-MM-DD.
 * Returns: e.g. "2026-05-26T00:00:00Z"
 */
export function normalizeDate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (ISO_DATE_RE.test(trimmed)) return `${trimmed}T00:00:00Z`;
  if (ISO_DATETIME_RE.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  // Unknown date format — return as-is rather than fail; round-tripped via raw.
  return trimmed;
}

/** Coerce a task size into the integer 1|2|3, or undefined if absent/invalid. */
export function normalizeSize(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return undefined;
  const rounded = Math.round(n);
  return rounded >= 1 && rounded <= 3 ? rounded : undefined;
}

/** Coerce a YAML scalar/array/comma-string into a string[]. */
export function toStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') {
    // Obsidian-comma form: "risk, register"
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [String(value)];
}

/** Slugify a string: lowercase ASCII kebab-case. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 100);
}

export interface NormalizeArgs {
  frontmatter: Record<string, unknown>;
  slug: string;
  outputPath: string;
  title: string;
  updated?: Date;
}

export function normalizeFrontmatter(args: NormalizeArgs): RobinFrontmatter {
  const { frontmatter, slug, outputPath, title, updated } = args;

  const rawType = (frontmatter.type as string | undefined)?.toString() || 'note';
  const meta: RobinMeta = {
    version: SPEC_VERSION,
    slug,
    path: outputPath,
    type: rawType,
    updated: normalizeDate(frontmatter.updated) ?? normalizeDate(updated) ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    created: normalizeDate(frontmatter.created),
    summary: (frontmatter.summary as string | undefined) ?? undefined,
    // 'status' and 'state' are the same lifecycle field in the current vault.
    // `status` is now the CANONICAL key on both read and write (the on-disk
    // convention: 49 task pages stamp `robin:status`). On input we accept both
    // keys, with `status` winning; on output `metaTagsForHead` emits a single
    // `robin:status` tag. `state` is preserved verbatim only so a legacy
    // `state:`-keyed source re-saves losslessly — but it converges to
    // `robin:status` on the next write.
    status: (frontmatter.status as string | undefined) ?? (frontmatter.state as string | undefined),
    state: (frontmatter.state as string | undefined) ?? (frontmatter.status as string | undefined),
    owner: (frontmatter.owner as string | undefined) ?? undefined,
    priority: (frontmatter.priority as string | undefined) ?? undefined,
    size: normalizeSize(frontmatter.size),
    due: normalizeDate(frontmatter.due),
    role: (frontmatter.role as string | undefined) ?? undefined,
    relationship: (frontmatter.relationship as string | undefined) ?? undefined,
    started: normalizeDate(frontmatter.started),
    date: normalizeDate(frontmatter.date),
    duration: (frontmatter.duration as string | undefined) ?? undefined,
    tier: (frontmatter.tier as string | undefined) ?? undefined,
    tags: toStringArray(frontmatter.tags),
    attendees: toStringArray(frontmatter.attendees),
    sources: [...toStringArray(frontmatter.source), ...toStringArray(frontmatter.sources)],
    unknownKeys: Object.keys(frontmatter).filter((k) => !KNOWN_KEYS.has(k)),
  };

  // Raw stores the ORIGINAL frontmatter verbatim for lossless round-trip.
  // We do NOT trust this for indexing — meta is authoritative.
  const raw: Record<string, unknown> = { ...frontmatter };
  // Add title to raw if it wasn't there but we derived it
  if (!raw.title && title) raw.title = title;

  return { raw, meta };
}

/**
 * Emit the <head> meta tags for a RobinMeta object.
 * Returns an array of [name, content] pairs in canonical order
 * (sorted by name, then by content for repeated keys).
 */
export function metaTagsForHead(meta: RobinMeta): Array<[string, string]> {
  const tags: Array<[string, string]> = [];
  const push = (name: string, content?: string) => {
    if (content !== undefined && content !== null && content !== '') {
      tags.push([name, String(content)]);
    }
  };

  push('robin:version', meta.version);
  push('robin:slug', meta.slug);
  push('robin:path', meta.path);
  push('robin:type', meta.type);
  push('robin:updated', meta.updated);
  push('robin:created', meta.created);
  push('robin:summary', meta.summary);
  // Canonical emit key is `robin:status` — it matches the on-disk vault
  // convention (task pages stamp `robin:status`). `state` is a synonym folded
  // into `status` by normalizeFrontmatter, so we emit a single `robin:status`
  // tag and never a separate `robin:state` (that would duplicate the value).
  // On read, both keys are accepted (read-page.buildMeta + extractMeta), so a
  // legacy `robin:state` page still resolves and converges to `robin:status`
  // the next time it is saved through this writer.
  push('robin:status', meta.status ?? meta.state);
  push('robin:owner', meta.owner);
  push('robin:priority', meta.priority);
  push('robin:size', meta.size !== undefined ? String(meta.size) : undefined);
  push('robin:due', meta.due);
  push('robin:role', meta.role);
  push('robin:relationship', meta.relationship);
  push('robin:started', meta.started);
  push('robin:date', meta.date);
  push('robin:duration', meta.duration);
  push('robin:tier', meta.tier);
  for (const tag of [...meta.tags].sort()) push('robin:tag', tag);
  for (const att of [...meta.attendees].sort()) push('robin:attendee', att);
  for (const src of [...meta.sources].sort()) push('robin:source', src);

  // Canonical order: by name, then by content
  tags.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });
  return tags;
}
