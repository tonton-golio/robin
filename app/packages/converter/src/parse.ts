/**
 * Canonical READ-side parsing for Robin HTML pages.
 *
 * This is the single source of truth for:
 *   (a) extracting a normalized `RobinMeta` from a page's <head> meta tags
 *       ({@link extractMetaFromMap}), and
 *   (b) the shared HTML→{title, metaMap, frontmatter, blocks, article, wikilinks}
 *       parse core ({@link parseRobinHtmlCore}).
 *
 * It lives in @robin/converter (the lowest-level format package, which already
 * owns the WRITE side: normalizeFrontmatter / metaTagsForHead / canonicalize)
 * so that the web app, the indexer, and the MCP server all consume ONE
 * implementation instead of three near-identical copies. Those copies had
 * already drifted — most visibly the robin:status-vs-state synonym handling and
 * the silently-dropped `size` field — which is exactly the bug class this
 * consolidation removes.
 *
 * Consumer-specific concerns stay in the consumer:
 *   - the web app's React/hast body serializer (with its SVG camelCase-attr
 *     allowlist and <style>/<script> stripping) — read-page.ts,
 *   - the indexer's plain-text body extraction for FTS + its own body HTML
 *     serializer — parse-html.ts.
 * Those operate on the `article` HAST node this core returns.
 */

import { fromHtml } from 'hast-util-from-html';
import { visit } from 'unist-util-visit';
import type { Root, Element, Text } from 'hast';
import type { RobinMeta } from './types.js';

// Legacy product name → robin: namespace. Spelled obliquely so a global
// rename of the new name never silently rewrites the legacy compatibility
// shim (the old copies did the same).
const META_PREFIX = 'robin:';
const LEGACY_META_PREFIX = ['her', 'mes:'].join('');
const FRONTMATTER_SCRIPT_ID = `${META_PREFIX}frontmatter`;
const BLOCKS_SCRIPT_ID = `${META_PREFIX}blocks`;
const LEGACY_FRONTMATTER_SCRIPT_ID = `${LEGACY_META_PREFIX}frontmatter`;
const LEGACY_BLOCKS_SCRIPT_ID = `${LEGACY_META_PREFIX}blocks`;
const DOC_ATTR = 'dataRobinDoc';
const LEGACY_DOC_ATTR = ['data', 'Her', 'mesDoc'].join('');

/**
 * Derive a basename slug from a vault-relative (or absolute) path, without
 * pulling in node:path — keeps this module dependency-light for all consumers.
 */
function basenameSlug(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  return base.replace(/\.html$/i, '');
}

/**
 * Build a normalized {@link RobinMeta} from a meta-map keyed by FULLY-QUALIFIED
 * `robin:*` names whose values are arrays (one entry per repeated <meta> tag).
 *
 * This is the canonical replacement for the formerly-duplicated
 * `buildMeta` (web read-page) and `extractMeta` (MCP html-utils).
 *
 * Key behaviors preserved from the originals:
 *   - `status` is CANONICAL; `state` falls back to `status` so status-keyed
 *     task pages don't collapse to an undefined/'open' default downstream.
 *   - `size` is coerced via Number() (matching read-page); the MCP copy used to
 *     omit `size` entirely, which left meta.size always undefined — its own
 *     rawFromMeta already reads meta.size, so populating it here fixes that
 *     latent drop rather than changing intended behavior.
 */
export function extractMetaFromMap(
  metaMap: Record<string, string[]>,
  vaultRelativePath: string
): RobinMeta {
  const get = (key: string): string | undefined => metaMap[key]?.[0];
  const getAll = (key: string): string[] => metaMap[key] ?? [];

  return {
    version: get('robin:version') ?? '0.1',
    slug: get('robin:slug') ?? basenameSlug(vaultRelativePath),
    path: get('robin:path') ?? vaultRelativePath,
    type: get('robin:type') ?? 'note',
    updated: get('robin:updated') ?? new Date().toISOString(),
    created: get('robin:created'),
    summary: get('robin:summary'),
    // On-disk task pages stamp `robin:status` (49 of them) while a handful use
    // `robin:state`; the two are synonyms in the vault. Surface `status`
    // verbatim AND fall back to it for `state` so status-keyed tasks no longer
    // collapse to the 'open' default in downstream consumers (lib/tasks.ts,
    // PageView, maintenance) that read `meta.state`.
    state: get('robin:state') ?? get('robin:status'),
    status: get('robin:status'),
    owner: get('robin:owner'),
    priority: get('robin:priority'),
    size: get('robin:size') !== undefined ? Number(get('robin:size')) : undefined,
    due: get('robin:due'),
    role: get('robin:role'),
    relationship: get('robin:relationship') as RobinMeta['relationship'],
    started: get('robin:started'),
    date: get('robin:date'),
    duration: get('robin:duration'),
    tier: get('robin:tier'),
    tags: getAll('robin:tag'),
    attendees: getAll('robin:attendee'),
    sources: getAll('robin:source'),
    unknownKeys: [],
  };
}

/** The raw building blocks shared by every Robin HTML reader. */
export interface RobinParseCore {
  /** Text of the document <title>, or '' if absent. */
  title: string;
  /**
   * `robin:*` meta tags from <head>, keyed by fully-qualified name with
   * array values (one per repeated <meta>). Legacy-namespaced tags are
   * normalized into `robin:*` keys. Feed straight into {@link extractMetaFromMap}.
   */
  metaMap: Record<string, string[]>;
  /** Parsed JSON of the legacy <script id="robin:frontmatter">, or null (v0.2). */
  frontmatter: unknown;
  /** Parsed JSON of the legacy <script id="robin:blocks">, or null (v0.2). */
  blocks: unknown;
  /** The <article data-robin-doc> HAST node, or null if the page has no body. */
  article: Element | null;
  /** `data-wiki` slugs referenced by <a> links inside the article body. */
  wikilinkTargets: string[];
}

/**
 * Parse a Robin HTML document into the building blocks every reader needs.
 *
 * Consumers add their own body serialization on top of the returned `article`
 * node (the web app's SVG-aware/React serializer; the indexer's plain-text +
 * HTML serializers) and call {@link extractMetaFromMap} on `metaMap`.
 */
export function parseRobinHtmlCore(html: string): RobinParseCore {
  const tree = fromHtml(html, { fragment: false }) as Root;

  let title = '';
  const metaMap: Record<string, string[]> = {};
  let frontmatter: unknown = null;
  let blocks: unknown = null;
  let article: Element | null = null;

  // Single head/body walk: <title>, robin:* <meta>, legacy JSON <script>,
  // and the <article data-robin-doc> root.
  visit(tree, 'element', (node: Element) => {
    if (node.tagName === 'title') {
      const textNode = node.children[0] as Text | undefined;
      if (textNode?.type === 'text') title = textNode.value;
      return;
    }

    if (node.tagName === 'meta') {
      const name = node.properties?.['name'] as string | undefined;
      const content = node.properties?.['content'];
      if (
        name &&
        (name.startsWith(META_PREFIX) || name.startsWith(LEGACY_META_PREFIX)) &&
        content !== undefined
      ) {
        const normalizedName = name.startsWith(LEGACY_META_PREFIX)
          ? `${META_PREFIX}${name.slice(LEGACY_META_PREFIX.length)}`
          : name;
        const val = content === null ? '' : String(content);
        (metaMap[normalizedName] ??= []).push(val);
      }
      return;
    }

    if (node.tagName === 'script') {
      const id = node.properties?.['id'] as string | undefined;
      if (
        id === FRONTMATTER_SCRIPT_ID ||
        id === BLOCKS_SCRIPT_ID ||
        id === LEGACY_FRONTMATTER_SCRIPT_ID ||
        id === LEGACY_BLOCKS_SCRIPT_ID
      ) {
        const textNode = node.children.find((c) => c.type === 'text') as Text | undefined;
        const text = textNode?.value ?? '';
        if (text) {
          try {
            const parsed = JSON.parse(text) as unknown;
            if (id === FRONTMATTER_SCRIPT_ID || id === LEGACY_FRONTMATTER_SCRIPT_ID) {
              frontmatter = parsed;
            } else {
              blocks = parsed;
            }
          } catch {
            // Malformed JSON — leave as null.
          }
        }
      }
      return;
    }

    if (
      node.tagName === 'article' &&
      node.properties &&
      (DOC_ATTR in node.properties || LEGACY_DOC_ATTR in node.properties)
    ) {
      article = node;
    }
  });

  // Wikilink targets: <a data-wiki="..."> inside the article body. Robin v0.2
  // dropped the embedded blocks JSON, so wikilinks come from the DOM directly.
  const wikilinkTargets: string[] = [];
  if (article) {
    visit(article as Element, 'element', (inner: Element) => {
      if (inner.tagName === 'a' && inner.properties) {
        const dw = inner.properties['dataWiki'];
        if (typeof dw === 'string' && dw) wikilinkTargets.push(dw);
      }
    });
  }

  return { title, metaMap, frontmatter, blocks, article, wikilinkTargets };
}
