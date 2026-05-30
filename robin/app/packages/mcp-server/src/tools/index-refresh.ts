/**
 * index.refresh — Force a full rescan of the vault into the SQLite index.
 *
 * Why this exists: the MCP write tools (page.write/create/move/delete,
 * task.create/update, link.add) change files on disk but do NOT incrementally
 * update the index. Until the next scan, search / backlinks / slug resolution
 * can be stale. This tool runs the same full scan the web app's POST
 * /api/resync runs (indexer.scan()), so a caller can refresh the index on
 * demand after a batch of writes.
 *
 * No-index mode: if the server started without an indexer (filesystem-only
 * fallback), there is nothing to refresh — return mode='no-index' honestly
 * rather than pretending a scan happened.
 */

import { z } from 'zod/v4';
import type { ToolContext } from '../types.js';

// Empty input — refresh takes no arguments (mirrors web /api/resync POST).
export const IndexRefreshInputSchema = z.object({});

export type IndexRefreshInput = z.infer<typeof IndexRefreshInputSchema>;

export interface IndexRefreshOutput {
  mode: 'indexer' | 'no-index';
  indexed: number;
  errors: number;
  wikilinks: number;
  ambiguous: number;
  pruned: number;
  duration_ms: number;
}

export async function indexRefresh(
  _input: IndexRefreshInput,
  ctx: ToolContext
): Promise<IndexRefreshOutput> {
  const started = Date.now();

  if (!ctx.indexer) {
    return {
      mode: 'no-index',
      indexed: 0,
      errors: 0,
      wikilinks: 0,
      ambiguous: 0,
      pruned: 0,
      duration_ms: Date.now() - started,
    };
  }

  const r = await ctx.indexer.scan();
  return {
    mode: 'indexer',
    indexed: r.indexed,
    errors: r.errors,
    wikilinks: r.wikilinks,
    ambiguous: r.ambiguous,
    pruned: r.pruned ?? 0,
    duration_ms: Date.now() - started,
  };
}
