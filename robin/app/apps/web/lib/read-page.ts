import fs from 'fs/promises';
import path from 'path';
import { cache } from 'react';
import type { Element, Text } from 'hast';
import type { RobinBlock, RobinMeta } from '@robin/converter';
import { parseRobinHtmlCore, extractMetaFromMap } from '@robin/converter';
import { resolveContainedVaultPath } from './vault-file';
import { vaultPageHref } from './routes';

/**
 * Top-level vault roots that hold slug-addressable HTML pages. buildSlugMap only
 * ever indexes pages under these prefixes, so the walk is scoped to them — walking
 * the whole vault would needlessly recurse giant `repos/` clones (thousands of
 * dirs) on every request. Order matters: earlier roots win on slug collisions.
 */
const SLUG_ROOTS = ['brain', 'out', 'logs'] as const;

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
 *
 * Wrapped in React `cache()` so the dynamic route's component render and its
 * `generateMetadata` (which both call readPage for the same path) share a single
 * file read + parse per request instead of doing the work twice.
 *
 * @param vaultRelativePath - vault-relative path, e.g. 'brain/_index.html'
 */
export const readPage = cache(async (vaultRelativePath: string): Promise<PageData | ReadPageError> => {
  let html: string;
  let mtime: Date;
  try {
    // Resolve through the realpath-containment check (same guard the /file and
    // /api/file routes use) so a symlink pointing outside the vault is rejected
    // instead of read+rendered. Throws → treated as not_found below.
    const absPath = await resolveContainedVaultPath(vaultRelativePath);
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
});

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
 * Serialize the INNER content of the <article data-robin-doc> node — its children
 * only, NOT the wrapping <article> tag. FlowPageView re-wraps this body in its own
 * <article data-robin-doc>; emitting the wrapper here too produced two nested
 * data-robin-doc articles (invalid markup + a strict-mode locator ambiguity).
 */
function childrenToHtmlString(node: Element): string {
  return (node.children ?? [])
    .map((c) => serializeHastNode(c as Element | Text))
    .join('');
}

function serializeHastNode(node: Element | Text | { type: string; children?: unknown[]; value?: string; tagName?: string; properties?: Record<string, unknown> }): string {
  if (node.type === 'text') {
    return escapeHtml((node as Text).value);
  }
  if (node.type === 'element') {
    const el = node as Element;
    const tag = el.tagName;
    // Sanitization: the rendered body goes through dangerouslySetInnerHTML, so
    // drop executable/active markup. <script> never runs via innerHTML anyway,
    // but stripping it (plus <style>, per the reader's documented "strip
    // style/script" contract) keeps ingested/untrusted vault HTML inert.
    if (tag === 'script' || tag === 'style') return '';
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

/** True for URL-bearing attributes whose value must be scheme-checked. */
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster']);

/** Reject javascript:/vbscript:/document-executable data: URLs that can run script. */
function isUnsafeUrl(value: string): boolean {
  const v = value.toLowerCase().replace(/[\u0000-\u0020]+/g, '');
  return (
    v.startsWith('javascript:') ||
    v.startsWith('vbscript:') ||
    v.startsWith('data:text/html') ||
    // SVG/XHTML loaded as a DOCUMENT via an iframe/object/embed src executes
    // embedded <script>, so these data: subtypes must be blocked too.
    v.startsWith('data:image/svg+xml') ||
    v.startsWith('data:application/xhtml+xml')
  );
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

// hast stores some HTML attributes under React/DOM property names that do NOT
// kebab-case back to the real attribute (className → class, NOT class-name; colspan
// → colSpan; for → htmlFor). Blindly kebab-casing these emits bogus attributes the
// browser ignores — dropping every body CSS class and collapsing table colspans.
// Map the known aliases explicitly; the kebab fallback still handles data-*/aria-*.
const HAST_ATTR_ALIASES: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  colSpan: 'colspan',
  rowSpan: 'rowspan',
  tabIndex: 'tabindex',
  readOnly: 'readonly',
  maxLength: 'maxlength',
  minLength: 'minlength',
  autoComplete: 'autocomplete',
  crossOrigin: 'crossorigin',
  dateTime: 'datetime',
  acceptCharset: 'accept-charset',
  httpEquiv: 'http-equiv',
  // Namespaced SVG/XML attributes: hast stores xlink:href → xLinkHref,
  // xml:lang → xmlLang, etc. The generic kebab fallback would emit x-link-href /
  // xml-lang (browser silently drops them), breaking <use xlink:href="#id"> and
  // gradient/pattern refs. An explicit alias to the colon form is required —
  // "preserve verbatim" via SVG_CAMELCASE_ATTRS would emit the wrong camelCase.
  xLinkHref: 'xlink:href',
  xLinkTitle: 'xlink:title',
  xLinkRole: 'xlink:role',
  xLinkArcRole: 'xlink:arcrole',
  xLinkShow: 'xlink:show',
  xLinkActuate: 'xlink:actuate',
  xLinkType: 'xlink:type',
  xmlLang: 'xml:lang',
  xmlSpace: 'xml:space',
  xmlBase: 'xml:base',
  xmlnsXLink: 'xmlns:xlink',
};

function propsToAttrs(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(props)) {
    if (val === false || val === null || val === undefined) continue;
    // Sanitization: never emit inline event handlers (onClick/onload/...).
    if (/^on/i.test(key)) continue;
    const attrName =
      HAST_ATTR_ALIASES[key] ??
      // SVG camelCase attributes must be preserved verbatim.
      (SVG_CAMELCASE_ATTRS.has(key)
        ? key
        // Convert camelCase data attributes back to kebab
        : key
            .replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)
            .replace(/^data-/, 'data-'));
    if (/^on/i.test(attrName)) continue;
    // hast token-list properties (className, rel, …) are arrays — join on a SPACE,
    // not String()'s comma, so `class="a b"` survives serialization.
    const value = Array.isArray(val) ? val.join(' ') : String(val);
    // Sanitization: drop URL-bearing attributes carrying executable schemes.
    if (
      (URL_ATTRS.has(attrName.toLowerCase()) || /(^|-)href$|(^|-)src$/.test(attrName.toLowerCase())) &&
      val !== true &&
      isUnsafeUrl(value)
    ) {
      continue;
    }
    if (val === true) {
      parts.push(attrName);
    } else {
      parts.push(`${attrName}="${escapeAttr(value)}"`);
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
 * Scan vault for all slug-addressable HTML pages and build a slug→path lookup.
 *
 * Scoped to SLUG_ROOTS (brain/out/logs) rather than the whole vault: the old
 * full-vault walk recursed every `repos/` git clone (thousands of dirs / ~200k
 * entries) on every request — the root cause of the ~4.5s dynamic-route latency.
 * Walking only the three slug-bearing roots cuts that to a few dozen dirs.
 *
 * Wrapped in React `cache()` so a single request that reads a page AND resolves
 * its wikilinks builds the map once.
 */
export const buildSlugMap = cache(async (vaultRoot: string): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  for (const root of SLUG_ROOTS) {
    await walkDir(path.join(vaultRoot, root), map, vaultRoot);
  }
  return map;
});

async function walkDir(dir: string, map: Map<string, string>, vaultRoot: string): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // fs.readdir order is filesystem-dependent (APFS sorts, ext4 returns hash
  // order), so sort before recursing/registering. Without this, first-seen-wins
  // for bare-basename slug collisions WITHIN a root resolves nondeterministically
  // across machines (e.g. brain/a/foo.html vs brain/b/foo.html for [[foo]]).
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden dirs and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      await walkDir(fullPath, map, vaultRoot);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      const rel = fullPath.slice(vaultRoot.length).replace(/^\//, '');
      // Index durable HTML pages plus generated operational artifacts
      // (logs/ now holds remsleep, briefs, meetings, interviews) so wikilinks
      // to them still resolve.
      if (rel.startsWith('brain/') || rel.startsWith('out/') || rel.startsWith('logs/')) {
        const relNoExt = rel.replace(/\.html$/, '');
        const rootRel = relNoExt.replace(/^(brain|out|logs)\//, ''); // e.g. repos/_index, beacon/beacon
        const base = path.basename(entry.name, '.html');             // e.g. _index, robin-gist
        // Register three slug forms so both path-style ([[repos/_index]]) and
        // bare-basename ([[robin-gist]]) wikilinks resolve. Path-style keys are
        // unique; the bare basename is collision-prone, so keep the FIRST seen.
        // SLUG_ROOTS walks brain→out→logs, so brain pages win across roots; and
        // because walkDir sorts each directory's entries, first-seen-wins within
        // a root is now reproducible (lexicographically smallest path) across
        // filesystems instead of depending on raw readdir order.
        for (const key of [rootRel, relNoExt, base]) {
          if (key && !map.has(key)) map.set(key, rel);
        }
      }
    }
  }
}

/**
 * Resolve a wikilink slug to a vault-relative path using the slug map.
 * Tries the slug verbatim (path-style or full), then falls back to its bare
 * basename — so a loose/legacy wikilink like [[beacon/beacon]] still finds the page
 * indexed at brain/projects/beacon/beacon.html under its basename key.
 */
export function resolveSlug(slugMap: Map<string, string>, slug: string): string | null {
  const exact = slugMap.get(slug);
  if (exact) return exact;
  if (slug.includes('/')) {
    const base = slug.slice(slug.lastIndexOf('/') + 1);
    return slugMap.get(base) ?? null;
  }
  return null;
}

/**
 * Rewrite baked wikilink placeholder hrefs (<a data-wiki="slug" href="/p/slug">)
 * in a serialized body to clean vault URLs, using a slug→path map.
 *
 * v0.2 pages read from disk have empty `blocks`, so they render `bodyHtml`
 * directly (FlowPageView) instead of going through the JSX wikilink resolver.
 * Without this pass every internal link stays a legacy `/p/<slug>` redirect —
 * a 307 round-trip before the (now fast) page render on every navigation.
 */
export function resolveWikilinkHrefs(
  bodyHtml: string,
  slugMap: Map<string, string>,
): string {
  return bodyHtml.replace(/<a\b([^>]*?)\sdata-wiki="([^"]+)"([^>]*)>/g, (_m, pre, slug, post) => {
    // Drop any existing href; we re-derive it from the slug map.
    const attrs = `${pre}${post}`.replace(/\shref="[^"]*"/g, '');
    const target = resolveSlug(slugMap, slug);
    if (target) {
      return `<a${attrs} data-wiki="${slug}" href="${vaultPageHref(target)}">`;
    }
    // Unresolved: mark broken and keep the /p/ fallback (which 404s helpfully).
    return `<a${attrs} data-wiki="${slug}" data-broken="missing" href="/p/${slug}">`;
  });
}

/** Reduce a heading's text to a comparable key (no tags, entities, punctuation). */
function headingKey(s: string): string {
  return s
    .replace(/<[^>]*>/g, '') // strip nested markup
    .replace(/&[#a-z0-9]+;/gi, ' ') // collapse HTML entities (&amp;, &#x2014; …)
    .replace(/[^a-z0-9]+/gi, '') // keep alphanumerics only
    .toLowerCase();
}

/**
 * Guarantee a single top-level <h1> per rendered page.
 *
 * The page chrome (PageWorkspace) already renders the document title as the page's
 * one <h1>. Robin v0.2 bodies conventionally repeat that title as their own first
 * <h1>, so the rendered page ends up with two identical <h1>s — a real a11y defect
 * (one-h1-per-document) and the cause of Playwright strict-mode "two matching
 * headings" failures. Strip the leading body <h1> when it duplicates the title,
 * then demote any remaining body <h1> to <h2> so exactly one <h1> survives.
 */
export function dedupeBodyHeadings(bodyHtml: string, title: string): string {
  if (!bodyHtml) return bodyHtml;
  const wanted = headingKey(title);
  let html = bodyHtml;
  // 1) Drop the first <h1>…</h1> whose text matches the page title (the body's
  //    conventional title heading — usually first, but scan all so it's dropped
  //    wherever it sits rather than left as a visible duplicate).
  let dropped = false;
  html = html.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (match, inner: string) => {
    if (!dropped && wanted && headingKey(inner) === wanted) {
      dropped = true;
      return '';
    }
    return match;
  });
  // 2) Demote any remaining <h1> (rare) to <h2> to keep a single top-level heading.
  html = html.replace(/<(\/?)h1\b/gi, '<$1h2');
  return html;
}
