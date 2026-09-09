/**
 * Search page — data contracts, hit mapping and highlight helpers.
 *
 * This page mirrors the agent's retrieval 1:1: pages come from `/api/search`
 * (the authoritative envelope carrying `mode: indexer | fallback`), memory
 * events come from `/api/knowledge` (MCP memory-search over events.jsonl).
 * Everything here maps those REAL response shapes into a single row model — no
 * field is invented. Where the indexer does not yet return a field (last-write
 * provenance, robin:tier, task status/due), the UI degrades honestly rather
 * than fabricating it (keep provenance tied to the stored source).
 */

import type { SearchHit } from '@/lib/indexer-client';
import { vaultPageHref } from '@/lib/routes';

// ── Real API response shapes (do not change; read-only) ────────────────────

/** `GET /api/search` — the authoritative pages envelope. */
export interface SearchApiResponse {
  hits: SearchHit[];
  mode: 'indexer' | 'fallback';
  query: string;
}

/** One field of the `GET /api/knowledge` envelope we consume: memory hits. */
export interface MemoryApiRecord {
  id: string;
  type: string;
  tier: string;
  status: string;
  subject: string;
  summary: string;
  body?: string;
  tags: string[];
  sources: { kind: string; ref: string; quote?: string }[];
  created_at: string;
  updated_at: string;
}

export interface MemoryApiHit {
  memory: MemoryApiRecord;
  score: number;
  matched: string[];
}

export interface KnowledgeApiResponse {
  query: string;
  memory: { mode: string; hits: MemoryApiHit[] };
  pages: SearchApiResponse;
}

// ── The single row model the page renders ──────────────────────────────────

export type Corpus = 'page' | 'task' | 'memory';

export interface UIHit {
  key: string;
  corpus: Corpus;
  /** Vault path (pages) or a display path for memory events. */
  path: string;
  /** Raw value copied by `y` — vault path or memory id. */
  copyValue: string;
  /** Where Enter opens the hit in its home surface. */
  homeHref: string;
  /** Where `o` opens the hit (vault tree / lineage). */
  treeHref: string;
  title: string;
  snippet: string;
  glyph: string;
  type?: string;
  /** Task/memory status when the source carries it; undefined otherwise. */
  status?: string;
  /** Human status pill label (memory review state / task status). */
  statusLabel?: string;
  statusKind?: 'active' | 'waiting' | 'done' | 'overdue';
  /** Small mono relevance score, dropped in degraded mode by CSS. */
  score: number;
  /** Terms to blue-highlight in the title + snippet. */
  matched: string[];
  /** Age in days since last write — only known for memory (updated_at). */
  sinceDays?: number;
  /** Provenance line: honest origin classification (+ actor when real). */
  provOrigin: string;
  provActor?: 'robin' | 'human';
  provDetail?: string;
}

// ── Mapping ─────────────────────────────────────────────────────────────────

const TYPE_GLYPH: Record<string, string> = {
  task: 'T',
  decision: 'D',
  hub: 'H',
  index: 'H',
  source: 'S',
  artifact: 'A',
  note: 'N',
  knowledge: 'N',
  pattern: 'N',
  playbook: 'N',
  person: 'N',
  project: 'H',
};

function glyphForPage(type: string | undefined, path: string): string {
  if (path.startsWith('out/')) return 'A';
  if (path.startsWith('inbox/')) return 'S';
  if (type && TYPE_GLYPH[type]) return TYPE_GLYPH[type];
  return 'N';
}

function pageOrigin(path: string): string {
  if (path.startsWith('out/')) return 'artifact · out/';
  if (path.startsWith('inbox/')) return 'immutable source · inbox/';
  return 'brain page';
}

export function mapPageHit(h: SearchHit): UIHit {
  const isTask = h.type === 'task' || h.path.startsWith('brain/tasks/');
  const isArtifact = h.path.startsWith('out/');
  const corpus: Corpus = isTask ? 'task' : 'page';
  const homeHref = isArtifact ? '/outputs' : vaultPageHref(h.path);
  return {
    key: `page:${h.path}`,
    corpus,
    path: h.path,
    copyValue: h.path,
    homeHref,
    treeHref: vaultPageHref(h.path),
    title: h.title || h.slug,
    snippet: (h.summary ?? '').trim(),
    glyph: isTask ? 'T' : glyphForPage(h.type, h.path),
    type: h.type,
    // The indexer hit does not carry robin:status/due yet, so task hits show a
    // neutral corpus pill rather than a fabricated Active/Overdue state.
    statusLabel: isTask ? 'Task' : undefined,
    statusKind: isTask ? 'waiting' : undefined,
    score: h.score,
    matched: [],
    provOrigin: pageOrigin(h.path),
  };
}

function daysSince(iso: string): number | undefined {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    .toLowerCase();
}

export function mapMemoryHit(h: MemoryApiHit): UIHit {
  const m = h.memory;
  const confirmed = m.status === 'active';
  const statusLabel = confirmed ? 'Confirmed' : m.status === 'tentative' ? 'Unreviewed' : m.status;
  const src = m.sources?.[0]?.ref;
  return {
    key: `memory:${m.id}`,
    corpus: 'memory',
    path: `brain/memory/events.jsonl · ${shortDate(m.updated_at)} · ${m.type}`,
    copyValue: m.id,
    homeHref: `/memory?id=${encodeURIComponent(m.id)}`,
    treeHref: `/memory?id=${encodeURIComponent(m.id)}`,
    title: m.subject || m.summary,
    snippet: m.summary || m.body || '',
    glyph: 'M',
    type: m.type,
    status: m.status,
    statusLabel,
    statusKind: confirmed ? 'done' : 'waiting',
    score: h.score,
    matched: Array.isArray(h.matched) ? h.matched : [],
    sinceDays: daysSince(m.updated_at),
    provOrigin: 'written by',
    provActor: 'robin',
    provDetail: `/learn · ${confirmed ? 'confirmed' : 'unreviewed'}${src ? ` · src: ${src}` : ''}`,
  };
}

// ── Highlight ────────────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Query → distinct highlight terms (whole words the index matched on, ≥2 ch). */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/\s+/)) {
    const t = raw.trim();
    if (t.length >= 2) seen.add(t);
  }
  return [...seen];
}
