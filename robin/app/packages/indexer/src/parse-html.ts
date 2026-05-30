/**
 * Parses a Robin HTML file and extracts all indexer-relevant data.
 *
 * Uses hast-util-from-html to build a HAST tree, then walks it with
 * unist-util-visit to extract:
 *   - <meta name="robin:*"> tags from <head>
 *   - JSON content from <script id="robin:frontmatter"> and <script id="robin:blocks">
 *   - Plain text of the <article data-robin-doc> body
 *   - data-wiki values of all wikilinks in the body
 *   - Raw inner HTML of the article body
 */

import type { Root, Element, Text } from 'hast';
import { parseRobinHtmlCore } from '@robin/converter';

export interface ParsedPage {
  /** All robin:* meta keys from <head>. Arrays accumulated from repeated <meta>. */
  meta: Record<string, string | string[]>;
  /** Parsed JSON of #robin:frontmatter script */
  frontmatter: unknown;
  /** Parsed JSON of #robin:blocks script */
  blocks: unknown;
  /** Stripped text content of <article data-robin-doc> */
  bodyText: string;
  /** All data-wiki values found in the body */
  wikilinkTargets: string[];
  /** Raw inner HTML of <article data-robin-doc> */
  bodyHtml: string;
}

/** Block-level HTML elements — used to insert spaces between blocks */
const BLOCK_ELEMENTS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'ul', 'ol', 'blockquote', 'pre', 'figure',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'aside', 'article', 'section', 'header', 'footer',
  'br',
]);

// Void (self-closing) HTML elements — never emit a closing tag for these.
// Includes wbr/area/col/source/track/embed/param so e.g. <wbr> is not wrongly
// closed as <wbr></wbr> (invalid markup that breaks word-break hints).
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// hast stores some HTML attributes under React/DOM property names that do NOT
// kebab-case back to the real attribute (className → class, NOT class-name;
// colspan → colSpan; for → htmlFor). Blindly kebab-casing these emits bogus
// attributes the browser ignores — dropping every body CSS class and collapsing
// table colspans. This is the WRITE side of the same map apps/web/lib/read-page.ts
// applies on read; both must stay in sync (frontmatter-only writes splice this
// serialized body back to disk verbatim, so the on-disk brain depends on it).
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
  // Namespaced SVG/XML attrs: hast camelCases the colon away (xlink:href →
  // xLinkHref), so the kebab fallback would emit the bogus `x-link-href`.
  xLinkHref: 'xlink:href',
  xLinkTitle: 'xlink:title',
  xLinkRole: 'xlink:role',
  xLinkArcRole: 'xlink:arcrole',
  xLinkShow: 'xlink:show',
  xLinkActuate: 'xlink:actuate',
  xmlLang: 'xml:lang',
  xmlSpace: 'xml:space',
  xmlBase: 'xml:base',
  xmlnsXLink: 'xmlns:xlink',
};

// SVG attributes whose names are case-sensitive camelCase. Kebab-casing them
// (viewBox → view-box) yields invalid attributes the browser silently drops —
// which crops inline-SVG charts (no viewBox → no coordinate mapping). Preserve
// verbatim. Mirrors apps/web/lib/read-page.ts.
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

/**
 * Serialize an element's children back to HTML.
 * This is a minimal serializer sufficient for storing bodyHtml.
 */
function serializeToHtml(node: Root | Element): string {
  const parts: string[] = [];

  for (const child of node.children) {
    if (child.type === 'text') {
      // Escape minimal characters
      parts.push(
        (child as Text).value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
      );
    } else if (child.type === 'element') {
      const el = child as Element;
      const tag = el.tagName;
      const attrs = Object.entries(el.properties ?? {})
        .map(([k, v]) => {
          const attrName = propNameToAttr(k);
          if (v === true) return ` ${attrName}`;
          if (v === false || v === null || v === undefined) return '';
          // hast token-list properties (className, rel, …) are arrays — join on
          // a SPACE, not String()'s comma, so `class="a b"` survives.
          const val = Array.isArray(v) ? v.join(' ') : String(v);
          return ` ${attrName}="${val.replace(/"/g, '&quot;')}"`;
        })
        .join('');
      const inner = serializeToHtml(el);
      if (VOID_TAGS.has(tag)) {
        parts.push(`<${tag}${attrs}>`);
      } else {
        parts.push(`<${tag}${attrs}>${inner}</${tag}>`);
      }
    } else if ((child as { type: string }).type === 'raw') {
      parts.push((child as { type: string; value: string }).value);
    }
  }

  return parts.join('');
}

/**
 * Map a hast property name back to its real HTML/SVG attribute name. hast uses
 * React/DOM camelCase property names (className, colSpan, htmlFor, …) that are
 * NOT valid HTML attributes; emit the aliased real name. SVG camelCase attrs are
 * case-sensitive and preserved verbatim; everything else (data-/aria- attrs) is
 * kebab-cased.
 */
function propNameToAttr(str: string): string {
  const alias = HAST_ATTR_ALIASES[str];
  if (alias) return alias;
  if (SVG_CAMELCASE_ATTRS.has(str)) return str;
  // data*/aria*/plain attrs: dataWiki → data-wiki, ariaLabel → aria-label.
  return str.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Extract text from an element tree, inserting spaces at block boundaries.
 * Skips <script>, <style>, and <code> elements to avoid polluting plain text.
 */
function extractText(node: Root | Element, parts: string[], skipCode = false): void {
  if (node.type === 'element') {
    const el = node as Element;
    // Skip script/style
    if (el.tagName === 'script' || el.tagName === 'style') return;
    // Skip code if requested (we don't want literal code in FTS body)
    // Actually per spec we keep code text for FTS, just not wikilinks inside it
    const isBlock = BLOCK_ELEMENTS.has(el.tagName);
    if (isBlock && parts.length > 0 && parts[parts.length - 1] !== ' ') {
      parts.push(' ');
    }
    for (const child of el.children) {
      if (child.type === 'text') {
        const val = (child as Text).value;
        if (val.trim()) parts.push(val);
      } else if (child.type === 'element') {
        extractText(child as Element, parts, skipCode);
      }
    }
    if (isBlock && parts.length > 0 && parts[parts.length - 1] !== ' ') {
      parts.push(' ');
    }
  } else if (node.type === 'root') {
    const root = node as Root;
    for (const child of root.children) {
      if (child.type === 'element') {
        extractText(child as Element, parts, skipCode);
      }
    }
  }
}

export function parseRobinHtml(html: string): ParsedPage {
  // Shared head/article parse lives in @robin/converter (the canonical reader).
  // The indexer keeps its own body serialization: plain-text extraction for FTS
  // (extractText) and a minimal kebab-attr HTML serializer (serializeToHtml).
  const core = parseRobinHtmlCore(html);

  // The indexer's public `meta` shape collapses single-valued keys to a string
  // and only promotes to an array on repeat. The core always uses arrays, so
  // fold back to the historical shape for callers that read `meta['robin:x']`.
  const meta: Record<string, string | string[]> = {};
  for (const [name, values] of Object.entries(core.metaMap)) {
    meta[name] = values.length === 1 ? values[0]! : values;
  }

  let bodyText = '';
  let bodyHtml = '';

  if (core.article) {
    const art = core.article;
    // Extract plain text
    const parts: string[] = [];
    extractText(art, parts);
    bodyText = parts.join('').replace(/\s+/g, ' ').trim();

    // Serialize body HTML
    bodyHtml = serializeToHtml(art);
  }

  return {
    meta,
    frontmatter: core.frontmatter,
    blocks: core.blocks,
    bodyText,
    wikilinkTargets: core.wikilinkTargets,
    bodyHtml,
  };
}
