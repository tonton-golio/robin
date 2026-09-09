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

import type { Element, Root, Text } from "hast";
import { fromHtml } from "hast-util-from-html";
import { visit } from "unist-util-visit";
import type { RobinMeta, RobinSourceKind } from "./types.js";

// Legacy product name → robin: namespace. Spelled obliquely so a global
// rename of the new name never silently rewrites the legacy compatibility
// shim (the old copies did the same).
const META_PREFIX = "robin:";
const LEGACY_META_PREFIX = ["her", "mes:"].join("");
const FRONTMATTER_SCRIPT_ID = `${META_PREFIX}frontmatter`;
const BLOCKS_SCRIPT_ID = `${META_PREFIX}blocks`;
const LEGACY_FRONTMATTER_SCRIPT_ID = `${LEGACY_META_PREFIX}frontmatter`;
const LEGACY_BLOCKS_SCRIPT_ID = `${LEGACY_META_PREFIX}blocks`;
const DOC_ATTR = "dataRobinDoc";
const LEGACY_DOC_ATTR = ["data", "Her", "mesDoc"].join("");

/**
 * Derive a basename slug from a vault-relative (or absolute) path, without
 * pulling in node:path — keeps this module dependency-light for all consumers.
 */
function basenameSlug(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  return base.replace(/\.html$/i, "");
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
  vaultRelativePath: string,
): RobinMeta {
  const get = (key: string): string | undefined => metaMap[key]?.[0];
  const getAll = (key: string): string[] => metaMap[key] ?? [];
  const sourceKinds = getAll("robin:source-kind") as RobinSourceKind[];
  const sourceRefs = getAll("robin:source-ref");
  const legacySources = getAll("robin:source");

  return {
    version: get("robin:version") ?? "0.1",
    id: get("robin:id"),
    slug: get("robin:slug") ?? basenameSlug(vaultRelativePath),
    path: get("robin:path") ?? vaultRelativePath,
    type: get("robin:type") ?? "note",
    updated: get("robin:updated") ?? new Date().toISOString(),
    created: get("robin:created"),
    summary: get("robin:summary"),
    // On-disk task pages stamp `robin:status` (49 of them) while a handful use
    // `robin:state`; the two are synonyms in the vault. Surface `status`
    // verbatim AND fall back to it for `state` so status-keyed tasks no longer
    // collapse to the 'open' default in downstream consumers (lib/tasks.ts,
    // PageView, maintenance) that read `meta.state`.
    state: get("robin:state") ?? get("robin:status"),
    status: get("robin:status"),
    owner: get("robin:owner"),
    priority: get("robin:priority"),
    size: get("robin:size") !== undefined ? Number(get("robin:size")) : undefined,
    due: get("robin:due"),
    // Planned schedule window (timeline bar origin/terminus). Date-only like
    // `due`; both must be listed here or they never reach RobinMeta.
    start: get("robin:start"),
    end: get("robin:end"),
    // First-class task fields stamped across the vault (robin:category on 51
    // pages). Previously unknown to this extractor, so they fell into the
    // metaMap but never reached RobinMeta — surfacing them here flows them to
    // the web app, MCP, and the canonical writer.
    category: get("robin:category"),
    project: get("robin:project"),
    next_action: get("robin:next_action"),
    acceptance: get("robin:acceptance"),
    kind: get("robin:kind"),
    parent: get("robin:parent"),
    planned: get("robin:planned"),
    role: get("robin:role"),
    relationship: get("robin:relationship") as RobinMeta["relationship"],
    started: get("robin:started"),
    date: get("robin:date"),
    duration: get("robin:duration"),
    tier: get("robin:tier"),
    // `robin:tag` (one meta per tag) is canonical and the only thing the writer
    // emits. Four pages on disk carry a comma-list `robin:tags` instead — read
    // as a fallback so their tags are not silently invisible everywhere. Any
    // rewrite through the canonical writer normalizes them to `robin:tag`.
    tags: metaMap["robin:tag"]
      ? getAll("robin:tag")
      : (get("robin:tags") ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
    attendees: getAll("robin:attendee"),
    sources: sourceRefs.length > 0 ? sourceRefs : legacySources,
    sourceKinds: sourceKinds.length > 0 ? sourceKinds : undefined,
    sourceRefs: sourceRefs.length > 0 ? sourceRefs : undefined,
    unknownKeys: [],
  };
}

/** The raw building blocks shared by every Robin HTML reader. */
export interface RobinParseCore {
  /** Text of the document <title>, or '' if absent. */
  title: string;
  /** Text of the first real <head> title, or '' if absent. */
  headTitle: string;
  /** Number of title elements in the real document head. */
  headTitleCount: number;
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
  /** Number of canonical Robin articles found in the document. */
  articleCount: number;
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

  let title = "";
  let headTitle = "";
  let headTitleCount = 0;
  const metaMap: Record<string, string[]> = {};
  let frontmatter: unknown = null;
  let blocks: unknown = null;
  let article: Element | null = null;
  let articleCount = 0;

  // Metadata has authority only inside the real <head>. A body <meta>, inline
  // example, or commented-out tag must never be able to replace page identity.
  let head: Element | undefined;
  visit(tree, "element", (node: Element) => {
    if (!head && node.tagName === "head") head = node;
  });
  if (head) {
    visit(head, "element", (node: Element) => {
      if (node.tagName === "title") {
        headTitleCount += 1;
        if (!headTitle) {
          const textNode = node.children[0] as Text | undefined;
          if (textNode?.type === "text") headTitle = textNode.value;
        }
        return;
      }
      if (node.tagName !== "meta") return;
      const rawName = node.properties?.name as string | undefined;
      const content = node.properties?.content;
      const name = rawName?.toLowerCase();
      if (
        name &&
        (name.startsWith(META_PREFIX) || name.startsWith(LEGACY_META_PREFIX)) &&
        content !== undefined
      ) {
        const normalizedName = name.startsWith(LEGACY_META_PREFIX)
          ? `${META_PREFIX}${name.slice(LEGACY_META_PREFIX.length)}`
          : name;
        const val = content === null ? "" : String(content);
        const values = metaMap[normalizedName] ?? [];
        values.push(val);
        metaMap[normalizedName] = values;
      }
    });
  }

  // Head/body walk for the display title, legacy JSON payloads, and article.
  visit(tree, "element", (node: Element) => {
    if (node.tagName === "title") {
      // FIRST title wins. `<title>` is not unique to <head>: inline SVG uses it
      // for accessible names and chart tooltips, and those live in the body, so
      // last-one-wins named several out/ artifacts after a bar in one of their
      // own charts. The head title precedes any body content in document order,
      // so taking the first is the whole fix.
      if (title) return;
      const textNode = node.children[0] as Text | undefined;
      if (textNode?.type === "text") title = textNode.value;
      return;
    }

    if (node.tagName === "script") {
      const id = node.properties?.id as string | undefined;
      if (
        id === FRONTMATTER_SCRIPT_ID ||
        id === BLOCKS_SCRIPT_ID ||
        id === LEGACY_FRONTMATTER_SCRIPT_ID ||
        id === LEGACY_BLOCKS_SCRIPT_ID
      ) {
        const textNode = node.children.find((c) => c.type === "text") as Text | undefined;
        const text = textNode?.value ?? "";
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
      node.tagName === "article" &&
      node.properties &&
      (DOC_ATTR in node.properties || LEGACY_DOC_ATTR in node.properties)
    ) {
      articleCount += 1;
      if (!article) article = node;
    }
  });

  // Wikilink targets: <a data-wiki="..."> inside the article body. Robin v0.2
  // dropped the embedded blocks JSON, so wikilinks come from the DOM directly.
  const wikilinkTargets: string[] = [];
  if (article) {
    visit(article as Element, "element", (inner: Element) => {
      if (inner.tagName === "a" && inner.properties) {
        const dw = inner.properties.dataWiki;
        if (typeof dw === "string" && dw) wikilinkTargets.push(dw);
      }
    });
  }

  return {
    title,
    headTitle,
    headTitleCount,
    metaMap,
    frontmatter,
    blocks,
    article,
    articleCount,
    wikilinkTargets,
  };
}

/**
 * Refuse to run a format migration on generic HTML or an already-ambiguous
 * Robin document. Migrations are allowed to add version/path/identity fields,
 * but they must never turn an unrelated artifact into a page merely because
 * it happened to contain a <head>.
 */
export function assertRobinMigrationCandidate(html: string): RobinParseCore {
  const parsed = parseRobinHtmlCore(html);
  if (parsed.articleCount !== 1) {
    throw new Error(
      `migration requires exactly one <article data-robin-doc>; found ${parsed.articleCount}`,
    );
  }
  if (parsed.headTitleCount !== 1 || !parsed.headTitle.trim()) {
    throw new Error("migration requires exactly one non-empty <title> in <head>");
  }
  for (const name of ["robin:slug", "robin:type", "robin:updated"]) {
    const values = parsed.metaMap[name] ?? [];
    if (values.length !== 1 || !values[0]?.trim()) {
      throw new Error(`migration requires exactly one non-empty ${name}`);
    }
  }
  return parsed;
}
