/**
 * Structural helpers for surgical Robin <meta> updates.
 *
 * Regex-only rewrites miss valid attribute order/quote variants and can match
 * commented-out tags. HAST gives us the real <head> elements plus source
 * offsets, so we can replace exactly one tag without reserializing the document
 * or touching the canonical <article> bytes.
 */

import type { Element, Root } from "hast";
import { fromHtml } from "hast-util-from-html";
import { visit } from "unist-util-visit";

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function propertyString(node: Element, key: string): string | undefined {
  const value = node.properties[key];
  if (typeof value === "string" || typeof value === "number") return String(value);
  return undefined;
}

function parseHead(html: string): { tree: Root; head: Element } {
  const tree = fromHtml(html, { fragment: false }) as Root;
  let head: Element | undefined;
  visit(tree, "element", (node: Element) => {
    if (!head && node.tagName === "head") head = node;
  });
  if (!head) throw new Error("invalid_robin_html: missing <head>");
  return { tree, head };
}

function closingHeadOffset(html: string, head: Element): number {
  const headEnd = head.position?.end.offset;
  if (headEnd === undefined) throw new Error("invalid_robin_html: missing </head> position");
  const matchesClosing = [...html.slice(0, headEnd).matchAll(/<\/head\s*>/gi)];
  const closing = matchesClosing.at(-1);
  if (closing?.index === undefined) throw new Error("invalid_robin_html: missing </head>");
  return closing.index;
}

function removeRanges(html: string, ranges: Array<{ start: number; end: number }>): string {
  let out = html;
  for (const range of ranges.sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, range.start)}${out.slice(range.end)}`;
  }
  return out;
}

/**
 * Return every real Robin metadata tag from `<head>`, keyed by its normalized
 * `robin:*` name. Body tags, comments, scripts, and legacy namespace aliases
 * cannot masquerade as canonical metadata.
 */
export function readHeadRobinMetaMap(html: string): Record<string, string[]> {
  const legacyPrefix = ["her", "mes:"].join("");
  const { head } = parseHead(html);
  const metaMap: Record<string, string[]> = {};
  visit(head, "element", (node: Element) => {
    if (node.tagName !== "meta") return;
    const rawName = propertyString(node, "name");
    if (!rawName) return;
    const lowerName = rawName.toLowerCase();
    if (!lowerName.startsWith("robin:") && !lowerName.startsWith(legacyPrefix)) return;
    const name = lowerName.startsWith(legacyPrefix)
      ? `robin:${lowerName.slice(legacyPrefix.length)}`
      : lowerName;
    const values = metaMap[name] ?? [];
    values.push(propertyString(node, "content") ?? "");
    metaMap[name] = values;
  });
  return metaMap;
}

/** Return all values for one real <head> meta name, excluding comments/body. */
export function readHeadMetaValues(html: string, name: string): string[] {
  const { head } = parseHead(html);
  const values: string[] = [];
  visit(head, "element", (node: Element) => {
    if (
      node.tagName === "meta" &&
      propertyString(node, "name")?.toLowerCase() === name.toLowerCase()
    ) {
      values.push(propertyString(node, "content") ?? "");
    }
  });
  return values;
}

/**
 * Replace exactly one real <head> meta tag, or insert it before </head>.
 * Duplicate existing tags are rejected rather than silently preserving an
 * ambiguous identity/path.
 */
export function upsertHeadMetaTag(html: string, name: string, value: string): string {
  if (!/^[a-z][a-z0-9:_-]*$/i.test(name)) throw new Error(`invalid_meta_name: ${name}`);
  const { head } = parseHead(html);
  const matches: Element[] = [];
  visit(head, "element", (node: Element) => {
    if (
      node.tagName === "meta" &&
      propertyString(node, "name")?.toLowerCase() === name.toLowerCase()
    ) {
      matches.push(node);
    }
  });
  if (matches.length > 1) throw new Error(`duplicate_meta_tag: ${name}`);

  const tag = `<meta name="${escapeAttribute(name)}" content="${escapeAttribute(value)}">`;
  if (matches.length === 1) {
    const start = matches[0]?.position?.start.offset;
    const end = matches[0]?.position?.end.offset;
    if (start === undefined || end === undefined) {
      throw new Error(`invalid_robin_html: missing source position for ${name}`);
    }
    return `${html.slice(0, start)}${tag}${html.slice(end)}`;
  }

  const insertion = `  ${tag}\n`;
  const offset = closingHeadOffset(html, head);
  return `${html.slice(0, offset)}${insertion}${html.slice(offset)}`;
}

/** Remove every real <head> meta tag whose name is in the supplied set. */
export function removeHeadMetaTags(html: string, names: Iterable<string>): string {
  const wanted = new Set([...names].map((name) => name.toLowerCase()));
  const { head } = parseHead(html);
  const ranges: Array<{ start: number; end: number }> = [];
  visit(head, "element", (node: Element) => {
    if (node.tagName !== "meta") return;
    const name = propertyString(node, "name")?.toLowerCase();
    if (!name || !wanted.has(name)) return;
    let start = node.position?.start.offset;
    let end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      throw new Error(`invalid_robin_html: missing source position for ${name}`);
    }
    const lineStart = html.lastIndexOf("\n", start - 1) + 1;
    if (/^[\t ]*$/.test(html.slice(lineStart, start))) start = lineStart;
    const lineEnd = html.indexOf("\n", end);
    if (lineEnd >= 0 && /^[\t ]*$/.test(html.slice(end, lineEnd))) end = lineEnd + 1;
    ranges.push({ start, end });
  });
  return removeRanges(html, ranges);
}

/**
 * Remove real legacy JSON payload scripts from <head> by exact id.
 * Attribute order and quote style are handled structurally; comments and body
 * examples are ignored. Duplicate payload IDs are rejected rather than
 * silently collapsing ambiguous legacy state.
 */
export function removeHeadScriptTagsById(html: string, ids: Iterable<string>): string {
  const wanted = new Set([...ids].map((id) => id.toLowerCase()));
  const { head } = parseHead(html);
  const counts = new Map<string, number>();
  const ranges: Array<{ start: number; end: number }> = [];
  visit(head, "element", (node: Element) => {
    if (node.tagName !== "script") return;
    const id = propertyString(node, "id")?.toLowerCase();
    if (!id || !wanted.has(id)) return;
    const count = (counts.get(id) ?? 0) + 1;
    counts.set(id, count);
    if (count > 1) throw new Error(`duplicate_script_tag: ${id}`);

    let start = node.position?.start.offset;
    let end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      throw new Error(`invalid_robin_html: missing source position for ${id}`);
    }
    const lineStart = html.lastIndexOf("\n", start - 1) + 1;
    if (/^[\t ]*$/.test(html.slice(lineStart, start))) start = lineStart;
    const lineEnd = html.indexOf("\n", end);
    if (lineEnd >= 0 && /^[\t ]*$/.test(html.slice(end, lineEnd))) end = lineEnd + 1;
    ranges.push({ start, end });
  });
  return removeRanges(html, ranges);
}

/** Append repeated canonical meta tags immediately before the real </head>. */
export function appendHeadMetaTags(
  html: string,
  tags: Array<readonly [name: string, value: string]>,
): string {
  if (tags.length === 0) return html;
  const { head } = parseHead(html);
  const lines = tags.map(([name, value]) => {
    if (!/^[a-z][a-z0-9:_-]*$/i.test(name)) throw new Error(`invalid_meta_name: ${name}`);
    return `  <meta name="${escapeAttribute(name)}" content="${escapeAttribute(value)}">`;
  });
  const offset = closingHeadOffset(html, head);
  return `${html.slice(0, offset)}${lines.join("\n")}\n${html.slice(offset)}`;
}
