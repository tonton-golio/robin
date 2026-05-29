import type { RobinMeta, RobinBlock } from './types.js';
import { blocksToBodyHtml } from './blocks-to-html.js';
import { metaTagsForHead } from './meta.js';

/**
 * Public API for producing a canonical Robin HTML document from
 * the editor / save path (or any other caller that already has RobinBlock[]).
 *
 * This is the single source of truth. The web app and any future tools
 * must use this instead of re-implementing document assembly.
 *
 * v0.2 format: body HTML inside <article data-robin-doc> is the single source
 * of truth. The embedded JSON script tags (#robin:frontmatter, #robin:blocks)
 * have been dropped — blocks are an in-memory intermediate only during
 * conversion. Meta tags in <head> are canonical metadata.
 */

export interface CanonicalizeOptions {
  meta: RobinMeta;
  /**
   * The original (or merged) frontmatter, kept for back-compat with callers
   * that pass it through. In v0.2 we no longer persist it as JSON — only the
   * fields that are mirrored into <meta> tags survive on disk. We still accept
   * it here to derive the page title when no h1 is present in the blocks.
   */
  frontmatter: Record<string, unknown>;
  /**
   * The document body, either as RobinBlock[] (canonical conversion path) or
   * pre-rendered HTML string (frontmatter-only update path on v0.2 pages where
   * the source-of-truth body is already on disk).
   */
  blocks: RobinBlock[];
  /**
   * Optional pre-rendered body HTML. When provided, takes precedence over
   * `blocks` — used by v0.2 frontmatter-only updates to avoid re-rendering
   * (and possibly mangling) the existing on-disk body.
   */
  bodyHtml?: string;
  /** Override the `updated` timestamp. Defaults to "now" (ISO-8601 UTC, no ms). */
  updatedAt?: Date;
}

/**
 * Produce a complete, canonical <!doctype html> document.
 * - Sorts robin:* meta tags (by name, then content)
 * - Emits repeated <meta> for array fields (tags, attendees, sources)
 * - Always sets `updated` to now unless overridden
 * - Body HTML is produced by the shared blocksToBodyHtml emitter and is the
 *   single source of truth for the document body on disk (v0.2).
 */
export function canonicalizeHtml({
  meta,
  frontmatter,
  blocks,
  bodyHtml: bodyHtmlOverride,
  updatedAt,
}: CanonicalizeOptions): string {
  // Always set updated to now on save (or use the provided override)
  const updatedMeta: RobinMeta = {
    ...meta,
    updated: updatedAt
      ? updatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z')
      : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };

  const metaEntries = metaTagsForHead(updatedMeta);
  const metaTagsHtml = metaEntries
    .map(([name, content]) => `  <meta name="${escapeAttr(name)}" content="${escapeAttr(content)}">`)
    .join('\n');

  const slug = updatedMeta.slug;
  const title = (frontmatter['title'] as string | undefined) ?? slug;

  // Derive title from the first h1 in blocks when possible (matches web-app behavior)
  const firstHeading = blocks.find((b) => b.kind === 'heading' && b.level === 1);
  const pageTitle = firstHeading && firstHeading.kind === 'heading'
    ? firstHeading.content.map((i) => (i.kind === 'text' ? i.text : '')).join('')
    : title;

  const bodyHtml = bodyHtmlOverride !== undefined
    ? bodyHtmlOverride.replace(/^\s+|\s+$/g, '')
    : blocksToBodyHtml(blocks);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeAttr(pageTitle)}</title>
  <link rel="canonical" href="/p/${escapeAttr(slug)}">
${metaTagsHtml}
</head>
<body>
  <article data-robin-doc>
${bodyHtml ? indentLines(bodyHtml, 4) + '\n' : ''}
  </article>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function indentLines(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map((l) => (l.length > 0 ? pad + l : l)).join('\n');
}
