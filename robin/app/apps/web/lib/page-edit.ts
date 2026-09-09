/**
 * getPageForEdit — the editor's LOAD path.
 *
 * Reads a page's CANONICAL on-disk HTML and parses it into RobinBlock[] via the
 * converter's htmlToBlocks. Critically it parses the disk article (NOT the
 * rendered DOM, which is heading-demoted + wikilink-resolved + style-stripped) so
 * a save can't lose content: savePage regenerates the body from blocksToBodyHtml,
 * so the load parser is the only guard against first-save loss. See
 * robin/app/docs/edit-log-ingest.md.
 *
 * Editability gate (v1 decisions): (1) only brain/ pages; (2) only pages whose
 * content fully maps to structured blocks — any html{raw} fallback means the page
 * carries markup the WYSIWYG editor would mangle (inline SVG, style, class,
 * colspan, custom tags), so it stays read-only.
 */

import fs from 'fs/promises';
import {
  parseRobinHtmlCore,
  htmlToBlocks,
  extractMetaFromMap,
  frontmatterFromMeta,
} from '@robin/converter';
import { hashHtml } from '@robin/vault-io';
import type { RobinBlock } from '@robin/converter';
import { normalizeVaultFilePath, resolveContainedVaultPath } from './vault-file';

export interface EditablePage {
  path: string;
  title: string;
  summary?: string;
  /** Canonical metadata projection to round-trip on save. */
  frontmatter: Record<string, unknown>;
  /** Exact on-disk SHA-256 to pass as expected_hash. */
  content_hash: string;
  blocks: RobinBlock[];
  editable: boolean;
  /** Why the page is not editable (present only when editable === false). */
  reason?: string;
}

export interface PageEditError {
  error: string;
}

export async function getPageForEdit(
  vaultRelativePath: string,
): Promise<EditablePage | PageEditError> {
  const safe = normalizeVaultFilePath(vaultRelativePath);
  if (!safe || !safe.endsWith('.html')) return { error: 'invalid path' };

  // v1 decision: the inline editor is gated to brain/ pages. out/ artifacts can
  // carry style/SVG/class that the block model can't represent, and logs/inbox
  // are operational records.
  if (!safe.startsWith('brain/')) {
    return { error: 'editing is limited to brain pages in v1' };
  }

  let html: string;
  try {
    const abs = await resolveContainedVaultPath(safe);
    html = await fs.readFile(abs, 'utf-8');
  } catch {
    return { error: 'not_found' };
  }

  const core = parseRobinHtmlCore(html);
  const blocks = core.article ? htmlToBlocks(core.article) : [];
  const meta = extractMetaFromMap(core.metaMap, safe);

  const hasRaw = blocksContainRaw(blocks);
  return {
    path: safe,
    title: core.title,
    ...(meta.summary ? { summary: meta.summary } : {}),
    frontmatter: { ...frontmatterFromMeta(meta), title: core.title },
    content_hash: hashHtml(html),
    blocks,
    editable: !hasRaw,
    ...(hasRaw
      ? { reason: 'page contains raw HTML (e.g. inline SVG, style, or custom markup) that the editor would not round-trip safely' }
      : {}),
  };
}

/** True if any block (or nested block) fell back to an html{raw} passthrough. */
function blocksContainRaw(blocks: RobinBlock[]): boolean {
  for (const b of blocks) {
    if (b.kind === 'html') return true;
    if (b.kind === 'quote' || b.kind === 'callout') {
      if (blocksContainRaw(b.children)) return true;
    } else if (b.kind === 'bulletList' || b.kind === 'numberedList') {
      for (const item of b.items) if (blocksContainRaw(item)) return true;
    } else if (b.kind === 'taskList') {
      for (const item of b.items) if (item.children && blocksContainRaw(item.children)) return true;
    }
  }
  return false;
}
