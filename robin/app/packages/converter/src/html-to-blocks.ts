/**
 * html-to-blocks — the structural inverse of blocks-to-html.ts.
 *
 * Turns canonical Robin body HTML back into RobinBlock[]. This is the missing
 * load-side counterpart the WYSIWYG editor needs: on load, parse the canonical
 * on-disk article into blocks (NOT the rendered DOM, which is heading-demoted +
 * wikilink-resolved + style-stripped); on save, blocksToBodyHtml regenerates the
 * canonical HTML. The invariant is round-trip stability:
 *
 *     blocksToBodyHtml(htmlToBlocks(blocksToBodyHtml(blocks))) === blocksToBodyHtml(blocks)
 *
 * Dispatch keys off the same data-* markers the serializer emits (data-block,
 * data-callout, data-checked, data-embed, data-query, data-lang, data-wiki),
 * which hast surfaces camelCased (dataBlock, …). Anything unrecognized falls back
 * to an html{raw} block (re-serialized via hast-util-to-html) so arbitrary vault
 * HTML survives. See robin/app/docs/edit-log-ingest.md.
 */

import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import type { Root, Element, ElementContent } from 'hast';
import type { RobinBlock, RobinInline, RobinMark, RobinTaskItem } from './types.js';

/** Inline-level tags blocksToBodyHtml emits, plus lenient aliases for pasted HTML. */
const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 's', 'del', 'strike', 'code', 'a', 'br', 'span']);

/** Parse a full <article> hast node's children into blocks. */
export function htmlToBlocks(article: Element): RobinBlock[] {
  return blocksFromNodes(article.children ?? []);
}

/** Parse a body-HTML string (the <article> inner HTML) into blocks. */
export function htmlBodyToBlocks(bodyHtml: string): RobinBlock[] {
  const root = fromHtml(bodyHtml, { fragment: true }) as Root;
  return blocksFromNodes(root.children as ElementContent[]);
}

// ── Block level ───────────────────────────────────────────────────────────────

function blocksFromNodes(nodes: ElementContent[]): RobinBlock[] {
  const out: RobinBlock[] = [];
  for (const n of nodes) {
    if (n.type === 'text') {
      // Whitespace between top-level blocks (blocksToBodyHtml joins with '\n').
      if (!n.value.trim()) continue;
      // Stray non-whitespace text at block level → wrap as a paragraph.
      out.push({ kind: 'paragraph', content: inlinesFromNodes([n]) });
      continue;
    }
    if (n.type !== 'element') continue; // comments etc.
    out.push(blockFromElement(n));
  }
  return out;
}

function blockFromElement(el: Element): RobinBlock {
  const tag = el.tagName;
  const dataBlock = attr(el, 'dataBlock');

  if (/^h[1-6]$/.test(tag)) {
    return { kind: 'heading', level: Number(tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6, content: inlinesFromNodes(el.children) };
  }
  if (tag === 'p') return { kind: 'paragraph', content: inlinesFromNodes(el.children) };
  if (tag === 'hr') return { kind: 'thematicBreak' };

  if (tag === 'pre') {
    const codeEl = childElements(el).find((c) => c.tagName === 'code');
    const code = codeEl ? textOf(codeEl) : textOf(el);
    const lang = attr(el, 'dataLang');
    return { kind: 'codeBlock', ...(lang ? { lang } : {}), code };
  }

  if (tag === 'blockquote') {
    return { kind: 'quote', children: blocksFromNodes(el.children) };
  }

  if (tag === 'aside' && attr(el, 'dataCallout') !== undefined) {
    return calloutFromAside(el);
  }

  if (tag === 'figure' && attr(el, 'dataEmbed') === 'image') {
    return imageFromFigure(el);
  }

  if (tag === 'ul' || tag === 'ol') {
    if (dataBlock === 'taskList') return taskListFromList(el);
    if (dataBlock === 'hubChildren') return { kind: 'hubChildren', query: attr(el, 'dataQuery') ?? '' };
    const items = listItemElements(el).map((li) => parseItemContent(li.children));
    if (tag === 'ol') {
      const startRaw = el.properties?.['start'];
      const start = typeof startRaw === 'number' ? startRaw : typeof startRaw === 'string' ? Number(startRaw) : NaN;
      return { kind: 'numberedList', items, ...(Number.isFinite(start) && start !== 1 ? { start } : {}) };
    }
    return { kind: 'bulletList', items };
  }

  if (tag === 'table') return tableFromElement(el);

  // Unrecognized element → raw HTML passthrough. Re-serialized canonically via
  // hast-util-to-html; byte-exact only from the 2nd canonicalize pass (documented).
  return { kind: 'html', raw: toHtml(el) };
}

function calloutFromAside(el: Element): RobinBlock {
  let title: string | undefined;
  const bodyNodes: ElementContent[] = [];
  for (const c of el.children ?? []) {
    if (c.type === 'element' && c.tagName === 'header' && attr(c, 'dataBlock') === 'calloutTitle') {
      const t = textOf(c).trim();
      if (t) title = t;
      continue;
    }
    bodyNodes.push(c);
  }
  return {
    kind: 'callout',
    calloutType: attr(el, 'dataCallout') ?? '',
    ...(attr(el, 'dataCollapsed') === 'true' ? { collapsed: true } : {}),
    ...(title ? { title } : {}),
    children: blocksFromNodes(bodyNodes),
  };
}

function imageFromFigure(el: Element): RobinBlock {
  const img = findDescendant(el, 'img');
  const wiki = img ? attr(img, 'dataWiki') : undefined;
  const alt = img ? attr(img, 'alt') : undefined;
  if (wiki) return { kind: 'embeddedImage', slug: wiki, ...(alt ? { alt } : {}) };
  const src = (img ? attr(img, 'src') : undefined) ?? '';
  return { kind: 'image', src, ...(alt ? { alt } : {}) };
}

function taskListFromList(el: Element): RobinBlock {
  const items: RobinTaskItem[] = listItemElements(el).map((li) => {
    const isTask = attr(li, 'dataBlock') === 'task';
    const checked = isTask ? attr(li, 'dataChecked') === 'true' : null;
    const { inline, blocks } = splitLeadingInline(li.children);
    return { checked, content: inline, ...(blocks.length ? { children: blocks } : {}) };
  });
  return { kind: 'taskList', items };
}

function tableFromElement(el: Element): RobinBlock {
  const thead = childElements(el).find((c) => c.tagName === 'thead');
  const tbody = childElements(el).find((c) => c.tagName === 'tbody');
  const headerRow = thead ? childElements(thead).find((c) => c.tagName === 'tr') : childElements(el).find((c) => c.tagName === 'tr');
  const bodyRows = tbody
    ? childElements(tbody).filter((c) => c.tagName === 'tr')
    : childElements(el).filter((c) => c.tagName === 'tr' && c !== headerRow);
  return {
    kind: 'table',
    headers: headerRow ? rowToInlines(headerRow) : [],
    rows: bodyRows.map(rowToInlines),
  };
}

function rowToInlines(row: Element): RobinInline[][] {
  return childElements(row)
    .filter((c) => c.tagName === 'th' || c.tagName === 'td')
    .map((c) => inlinesFromNodes(c.children));
}

/**
 * Invert renderItemContent: a list item is a leading run of inline nodes
 * (collapsed from a single paragraph) followed by zero+ block elements.
 */
function parseItemContent(children: ElementContent[]): RobinBlock[] {
  const { inline, blocks } = splitLeadingInline(children);
  if (inline.length > 0) return [{ kind: 'paragraph', content: inline }, ...blocks];
  if (blocks.length > 0) return blocks;
  return [{ kind: 'paragraph', content: [] }];
}

function splitLeadingInline(children: ElementContent[]): { inline: RobinInline[]; blocks: RobinBlock[] } {
  let i = 0;
  const leading: ElementContent[] = [];
  while (i < children.length && isInlineNode(children[i]!)) {
    leading.push(children[i]!);
    i++;
  }
  return { inline: inlinesFromNodes(leading), blocks: blocksFromNodes(children.slice(i)) };
}

function isInlineNode(n: ElementContent): boolean {
  if (n.type === 'text') return true;
  if (n.type === 'element') return INLINE_TAGS.has(n.tagName);
  return false;
}

// ── Inline level ───────────────────────────────────────────────────────────────

function inlinesFromNodes(nodes: ElementContent[]): RobinInline[] {
  const out: RobinInline[] = [];
  for (const n of nodes) {
    const r = inlineFromNode(n);
    if (Array.isArray(r)) out.push(...r);
    else if (r) out.push(r);
  }
  return mergeAdjacentText(out);
}

function inlineFromNode(node: ElementContent): RobinInline | RobinInline[] | null {
  if (node.type === 'text') return { kind: 'text', text: node.value };
  if (node.type !== 'element') return null;

  const tag = node.tagName;
  if (tag === 'br') return { kind: 'lineBreak' };

  const mark = markForTag(tag);
  if (mark) return addMark(inlinesFromNodes(node.children), mark);

  if (tag === 'code') return { kind: 'code', text: textOf(node) };

  if (tag === 'a') {
    const wiki = attr(node, 'dataWiki');
    if (wiki) {
      const label = textOf(node);
      return { kind: 'wikilink', slug: wiki, ...(label && label !== wiki ? { alias: label } : {}) };
    }
    return { kind: 'link', href: attr(node, 'href') ?? '', content: inlinesFromNodes(node.children) };
  }

  // Unknown inline wrapper (span, …) → flatten its children.
  return inlinesFromNodes(node.children);
}

function markForTag(tag: string): RobinMark | null {
  if (tag === 'strong' || tag === 'b') return 'bold';
  if (tag === 'em' || tag === 'i') return 'italic';
  if (tag === 's' || tag === 'del' || tag === 'strike') return 'strike';
  return null;
}

/** Mirror of mdast-to-blocks addMark: push a mark onto every mark-bearing inline. */
function addMark(inlines: RobinInline[], mark: RobinMark): RobinInline[] {
  return inlines.map((inline) => {
    if (inline.kind === 'text' || inline.kind === 'wikilink' || inline.kind === 'code') {
      const marks = inline.marks ? [...inline.marks, mark] : [mark];
      const uniq = [...new Set(marks)].sort() as RobinMark[];
      return { ...inline, marks: uniq };
    }
    if (inline.kind === 'link') {
      return { ...inline, content: addMark(inline.content, mark) };
    }
    return inline;
  });
}

/** Mirror of mdast-to-blocks mergeAdjacentText: coalesce same-mark text runs. */
function mergeAdjacentText(inlines: RobinInline[]): RobinInline[] {
  const out: RobinInline[] = [];
  for (const i of inlines) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.kind === 'text' &&
      i.kind === 'text' &&
      JSON.stringify(prev.marks ?? []) === JSON.stringify(i.marks ?? [])
    ) {
      out[out.length - 1] = { ...prev, text: prev.text + i.text };
    } else {
      out.push(i);
    }
  }
  return out;
}

// ── Hast helpers ────────────────────────────────────────────────────────────

function childElements(el: Element): Element[] {
  return (el.children ?? []).filter((c): c is Element => c.type === 'element');
}

function listItemElements(el: Element): Element[] {
  return childElements(el).filter((c) => c.tagName === 'li');
}

function findDescendant(el: Element, tag: string): Element | undefined {
  for (const c of el.children ?? []) {
    if (c.type !== 'element') continue;
    if (c.tagName === tag) return c;
    const nested = findDescendant(c, tag);
    if (nested) return nested;
  }
  return undefined;
}

/** Concatenated text content (hast values are already entity-decoded). */
function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return (node.children ?? []).map(textOf).join('');
  return '';
}

/** A property as a string, or undefined. hast stores data-* attrs as strings. */
function attr(el: Element, name: string): string | undefined {
  const v = el.properties?.[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '' : undefined;
  if (Array.isArray(v)) return v.join(' ');
  return undefined;
}
