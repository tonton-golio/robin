/**
 * MCP server tool request/response types.
 *
 * These are the TypeScript shapes for all tool inputs and outputs.
 * The actual Zod schemas live in each tool file.
 */

import type { RobinBlock, RobinMeta } from '@robin/converter';
import type { SearchHit } from '@robin/indexer';

// Re-export for consumers
export type { RobinBlock, RobinMeta, SearchHit };

// ── page.read ──────────────────────────────────────────────────────────────

export interface PageReadInput {
  ref: string;
}

export interface PageReadOutput {
  path: string;
  slug: string;
  meta: RobinMeta;
  frontmatter: unknown;
  blocks: unknown;
  body_html: string;
  links_out: LinkEntry[];
  links_in: LinkEntry[];
}

// ── page.write ─────────────────────────────────────────────────────────────

export interface PageWriteInput {
  ref: string;
  frontmatter?: Record<string, unknown>;
  body_md?: string;
}

export interface PageWriteOutput {
  path: string;
  slug: string;
  updated: string;
}

// ── page.write_many ────────────────────────────────────────────────────────

export interface WriteOp {
  ref: string;
  frontmatter?: Record<string, unknown>;
  body_md?: string;
}

export interface PageWriteManyInput {
  writes: WriteOp[];
}

export interface WriteResult {
  path: string;
  slug: string;
  status: 'ok' | 'error';
  error?: string;
}

export interface PageWriteManyOutput {
  results: WriteResult[];
}

// ── page.create ────────────────────────────────────────────────────────────

export interface PageCreateInput {
  folder: string;
  slug: string;
  type: string;
  frontmatter?: Record<string, unknown>;
  body_md?: string;
}

export interface PageCreateOutput {
  path: string;
  slug: string;
}

// ── page.move ──────────────────────────────────────────────────────────────

export interface PageMoveInput {
  from_ref: string;
  to_path: string;
}

export interface PageMoveOutput {
  old_path: string;
  new_path: string;
  refs_updated: 0;
}

// ── page.delete ────────────────────────────────────────────────────────────

export interface PageDeleteInput {
  ref: string;
  archive?: boolean;
}

export interface PageDeleteOutput {
  path: string;
  archived_to?: string;
}

// ── page.search ────────────────────────────────────────────────────────────

export interface PageSearchInput {
  query: string;
  k?: number;
  types?: string[];
  tiers?: string[];
  since?: string;
}

export interface PageSearchOutput {
  hits: SearchHit[];
  mode: 'rrf' | 'fallback';
}

// ── page.list ──────────────────────────────────────────────────────────────

export interface PageListInput {
  folder?: string;
  type?: string;
  state?: string;
  updated_since?: string;
}

export interface PageListItem {
  path: string;
  slug: string;
  type: string;
  title: string | null;
  summary?: string | null;
  updated: string | null;
}

export interface PageListOutput {
  items: PageListItem[];
}

// ── link.add ───────────────────────────────────────────────────────────────

export interface LinkAddInput {
  from_ref: string;
  to_ref: string;
  kind?: string;
}

export interface LinkAddOutput {
  from_slug: string;
  to_slug: string;
  kind: string;
  created: boolean;
}

// ── link.list ──────────────────────────────────────────────────────────────

export interface LinkListInput {
  ref: string;
  direction?: 'in' | 'out' | 'both';
}

export interface LinkEntry {
  slug: string;
  title?: string | null;
  path: string;
  kind: string;
}

export interface LinkListOutput {
  links: LinkEntry[];
}

// ── log.append ─────────────────────────────────────────────────────────────

export interface LogAppendInput {
  file: 'changelog' | 'ingest';
  entry_md: string;
}

export interface LogAppendOutput {
  file: string;
  bytes_written: number;
}

// ── task.create ────────────────────────────────────────────────────────────

export interface TaskCreateInput {
  title: string;
  summary?: string;
  priority?: string;
  due?: string;
  owner?: string;
  body_md?: string;
  tags?: string[];
}

export interface TaskCreateOutput {
  path: string;
  slug: string;
  log_entry: string;
}

// ── vault.lint ─────────────────────────────────────────────────────────────

export type LintCheck = 'frontmatter' | 'links' | 'orphans' | 'staleness';

export interface LintIssue {
  path: string;
  slug?: string;
  check: LintCheck;
  severity: 'error' | 'warning';
  message: string;
}

export interface VaultLintInput {
  check?: LintCheck[];
}

export interface VaultLintOutput {
  issues: LintIssue[];
}

// ── vault.stats ────────────────────────────────────────────────────────────

export type VaultStatsInput = Record<string, never>;

export interface VaultStatsOutput {
  pages: number;
  by_type: Record<string, number>;
  by_tier: Record<string, number>;
  links: number;
  broken_links: number;
  ambiguous_slugs: number;
}

// ── Internal context passed to all tool handlers ───────────────────────────

export interface ToolContext {
  vaultPath: string;
  indexer: IndexerHandle | null;
}

export interface IndexerHandle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  search(query: string, opts?: Record<string, unknown>): Promise<SearchHit[]>;
  /**
   * Force a full vault rescan into the index. Writes do not incrementally
   * update the index, so this is how a caller refreshes search/backlinks/
   * resolution after page.write/create/move/delete. Mirrors the web
   * /api/resync indexer path (indexer.scan()).
   */
  scan(): Promise<ScanResult>;
  close(): void;
}

/** Result of a full vault rescan. */
export interface ScanResult {
  indexed: number;
  errors: number;
  wikilinks: number;
  ambiguous: number;
}
