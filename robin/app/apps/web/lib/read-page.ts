import fs from 'fs/promises';
import path from 'path';
import type { Element, Text } from 'hast';
import type { RobinBlock, RobinMeta } from '@robin/converter';
import { parseRobinHtmlCore, extractMetaFromMap } from '@robin/converter';
import { vaultPath } from './vault';

export interface PageData {
  meta: RobinMeta;
  frontmatter: Record<string, unknown>;
  blocks: RobinBlock[];
  bodyHtml: string;
  title: string;
  filePath: string; // vault-relative
  mtime: Date;
  /** Slugs referenced by <a data-wiki="..."> in the article body. */
  wikilinkTargets: string[];
}

export interface ReadPageError {
  error: string;
  filePath: string;
}

/**
 * Read and parse a Robin HTML page from the vault.
 * @param vaultRelativePath - vault-relative path, e.g. 'brain/_index.html'
 */
export async function readPage(vaultRelativePath: string): Promise<PageData | ReadPageError> {
  const absPath = vaultPath(vaultRelativePath);

  let html: string;
  let mtime: Date;
  try {
    const stat = await fs.stat(absPath);
    mtime = stat.mtime;
    html = await fs.readFile(absPath, 'utf-8');
  } catch {
    return { error: 'not_found', filePath: vaultRelativePath };
  }

  try {
    return parseRobinHtml(html, vaultRelativePath, mtime);
  } catch (e) {
    return { error: `parse_error: ${e instanceof Error ? e.message : String(e)}`, filePath: vaultRelativePath };
  }
}

/**
 * Parse a Robin HTML document string into structured PageData.
 *
 * The head/article parse + meta extraction now come from the canonical
 * @robin/converter reader (shared with the indexer and MCP server). This module
 * keeps the WEB-ONLY body serializer (childrenToHtmlString / serializeHastNode)
 * with its SVG camelCase-attr allowlist, which must not be folded into the
 * shared core.
 */
export function parseRobinHtml(html: string, filePath: string, mtime: Date): PageData {
  const core = parseRobinHtmlCore(html);

  const title = core.title;
  // Defaults match the historical web behavior: an absent JSON payload yields an
  // empty object/array rather than null.
  const frontmatter = (core.frontmatter as Record<string, unknown> | null) ?? {};
  const blocks = (core.blocks as RobinBlock[] | null) ?? [];

  // Re-serialize the article body via the web-only SVG-aware serializer.
  const bodyHtml = core.article ? childrenToHtmlString(core.article) : '';
  const wikilinkTargets = core.wikilinkTargets;

  // Build meta object from extracted meta tags (canonical extractor).
  const meta = extractMetaFromMap(core.metaMap, filePath);

  return { meta, frontmatter, blocks, bodyHtml, title, filePath, mtime, wikilinkTargets };
}

/**
 * Very minimal hast → HTML string serializer for body content.
 * We just grab the source between the article tags using a regex on the original HTML
 * rather than re-serializing (more faithful to original).
 */
function childrenToHtmlString(node: Element): string {
  // We'll use hast-util-to-html if available, otherwise fall back
  // For now: concatenate text content recursively (good enough for display)
  // The real rendering goes through blocks-to-react anyway.
  // This function is used as a fallback only.
  return serializeHastNode(node);
}

function serializeHastNode(node: Element | Text | { type: string; children?: unknown[]; value?: string; tagName?: string; properties?: Record<string, unknown> }): string {
  if (node.type === 'text') {
    return escapeHtml((node as Text).value);
  }
  if (node.type === 'element') {
    const el = node as Element;
    const tag = el.tagName;
    const attrs = propsToAttrs(el.properties ?? {});
    const children = (el.children ?? [])
      .map((c) => serializeHastNode(c as Element | Text))
      .join('');
    const voidTags = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
    if (voidTags.has(tag)) return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${children}</${tag}>`;
  }
  return '';
}

// SVG attributes whose names are case-sensitive camelCase. Blindly kebab-casing
// them (viewBox → view-box, preserveAspectRatio → preserve-aspect-ratio) yields
// invalid attributes the browser silently drops — which made inline-SVG charts in
// out/ docs render cropped (no viewBox → no coordinate mapping). Preserve verbatim.
const SVG_CAMELCASE_ATTRS = new Set([
  'viewBox', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform',
  'patternUnits', 'patternContentUnits', 'patternTransform', 'clipPathUnits',
  'spreadMethod', 'stdDeviation', 'baseFrequency', 'numOctaves', 'stitchTiles',
  'surfaceScale', 'specularConstant', 'specularExponent', 'diffuseConstant',
  'kernelMatrix', 'kernelUnitLength', 'targetX', 'targetY', 'edgeMode',
  'xChannelSelector', 'yChannelSelector', 'lengthAdjust', 'textLength',
  'pathLength', 'startOffset', 'attributeName', 'repeatCount', 'keyPoints',
  'keyTimes', 'calcMode', 'keySplines', 'tableValues',
]);

function propsToAttrs(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(props)) {
    if (val === false || val === null || val === undefined) continue;
    // SVG camelCase attributes must be preserved verbatim.
    const attrName = SVG_CAMELCASE_ATTRS.has(key)
      ? key
      // Convert camelCase data attributes back to kebab
      : key
          .replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)
          .replace(/^data-/, 'data-');
    if (val === true) {
      parts.push(attrName);
    } else {
      parts.push(`${attrName}="${escapeAttr(String(val))}"`);
    }
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Scan vault for all HTML pages and build a slug→path lookup.
 */
export async function buildSlugMap(vaultRoot: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await walkDir(vaultRoot, map, vaultRoot);
  return map;
}

async function walkDir(dir: string, map: Map<string, string>, vaultRoot: string): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden dirs and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      await walkDir(fullPath, map, vaultRoot);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      const rel = fullPath.slice(vaultRoot.length).replace(/^\//, '');
      const slug = path.basename(entry.name, '.html');
      // Index durable HTML pages plus generated operational artifacts
      // (logs/ now holds remsleep, briefs, meetings, interviews) so wikilinks
      // to them still resolve.
      if (rel.startsWith('brain/') || rel.startsWith('out/') || rel.startsWith('logs/')) {
        map.set(slug, rel);
      }
    }
  }
}
