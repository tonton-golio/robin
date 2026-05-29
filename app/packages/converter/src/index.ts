import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import { remarkWikilink } from './wikilink.js';
import { mdastToBlocks } from './mdast-to-blocks.js';
import { blocksToBodyHtml } from './blocks-to-html.js';
import { normalizeFrontmatter, metaTagsForHead, slugify } from './meta.js';
import type { ConvertOptions, ConvertResult, RobinBlock, RobinMeta } from './types.js';

export * from './types.js';
export { slugify, normalizeDate } from './meta.js';

// ── Public rendering & canonicalization API ──────────────────────────────────
// These are the single source of truth for turning RobinBlock[] + meta into
// the canonical <!doctype html> documents that Robin stores on disk.
// The web app (and future tools) must import from here, not re-implement.

export { blocksToBodyHtml } from './blocks-to-html.js';
export { canonicalizeHtml, type CanonicalizeOptions } from './canonicalize.js';
// Frontmatter → RobinMeta normalizer, exported so tools (MCP server) can build
// canonical pages via canonicalizeHtml without re-implementing meta derivation.
export { normalizeFrontmatter, type NormalizeArgs } from './meta.js';

// ── Canonical READ side ──────────────────────────────────────────────────────
// The single source of truth for parsing a Robin HTML page's <head> meta into a
// RobinMeta and for the shared HTML parse core. Web/indexer/MCP import these
// instead of maintaining their own near-identical copies (the source of the
// robin:status-vs-state and dropped-`size` drift).
export {
  extractMetaFromMap,
  parseRobinHtmlCore,
  type RobinParseCore,
} from './parse.js';

/**
 * Convert markdown to a Robin HTML document.
 *
 * Flow: gray-matter → remark-parse + remark-gfm + remark-wikilink → mdast
 *      → mdastToBlocks → RobinBlock[]  (in-memory intermediate)
 *      → blocksToBodyHtml + metaTagsForHead
 *      → final HTML (v0.2: no #robin:frontmatter / #robin:blocks scripts;
 *        the <article> body is the single source of truth on disk)
 */
export function convertMarkdown(markdown: string, options: ConvertOptions): ConvertResult {
  const warnings: string[] = [];

  // 1. Parse frontmatter
  const { data: rawFrontmatter, content } = matter(markdown);

  // 2. Derive slug from output path
  const slug = pathToSlug(options.outputPath);

  // 3. Parse markdown body
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkWikilink);
  const tree = processor.parse(content) as Root;
  processor.runSync(tree);

  // 4. Derive title (first h1, then frontmatter, then slug)
  const title =
    options.title ?? findFirstHeadingText(tree) ?? (rawFrontmatter.title as string | undefined) ?? slug;

  // 5. Normalize frontmatter into RobinMeta
  const { raw, meta } = normalizeFrontmatter({
    frontmatter: rawFrontmatter,
    slug,
    outputPath: options.outputPath,
    title,
    updated: options.updated,
  });

  // 6. Convert mdast to RobinBlock[]
  const blocks = mdastToBlocks(tree);

  // 7. Render body + head
  const bodyHtml = blocksToBodyHtml(blocks);
  const html = assembleDocument({ title, meta, raw, blocks, bodyHtml });

  return { html, meta, blocks, warnings };
}

function pathToSlug(outputPath: string): string {
  const base = outputPath.split('/').pop() ?? outputPath;
  return base.replace(/\.html$/i, '');
}

function findFirstHeadingText(tree: Root): string | undefined {
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth === 1) {
      return extractText(node.children as Array<{ type: string; value?: string }>);
    }
  }
  return undefined;
}

function extractText(nodes: Array<{ type: string; value?: string; children?: unknown[] }>): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text' && typeof n.value === 'string') out += n.value;
    else if (n.children) out += extractText(n.children as Array<{ type: string; value?: string }>);
  }
  return out.trim();
}

interface AssembleArgs {
  title: string;
  meta: RobinMeta;
  raw: Record<string, unknown>;
  blocks: RobinBlock[];
  bodyHtml: string;
}

/**
 * v0.2: the document <head> contains only meta + <title> + <link rel="canonical">.
 * The previous #robin:frontmatter and #robin:blocks <script> payloads were
 * write-only dead weight and have been removed. The <article> body is now the
 * sole on-disk source of truth for document content; `blocks` and `raw` survive
 * in this signature only because callers still pass them, but they are not
 * persisted.
 */
function assembleDocument(args: AssembleArgs): string {
  const { title, meta, bodyHtml } = args;
  const tags = metaTagsForHead(meta);
  const metaLines = tags
    .map(([name, content]) => `  <meta name="${escapeAttr(name)}" content="${escapeAttr(content)}">`)
    .join('\n');

  return (
    `<!doctype html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `  <meta charset="utf-8">\n` +
    `  <title>${escapeText(title)}</title>\n` +
    `  <link rel="canonical" href="/p/${escapeAttr(meta.slug)}">\n` +
    `${metaLines}\n` +
    `</head>\n` +
    `<body>\n` +
    `  <article data-robin-doc>\n` +
    `${bodyHtml ? indentLines(bodyHtml, 4) + '\n' : ''}` +
    `  </article>\n` +
    `</body>\n` +
    `</html>\n`
  );
}

/**
 * Deterministic JSON serializer: sorts object keys recursively.
 * Output is indented (2 spaces) for git-diff readability.
 */
export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(value, replacer, 2);
}

function replacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
