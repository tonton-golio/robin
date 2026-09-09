/**
 * Small, dependency-free HTML tokenizer for repository governance scripts.
 *
 * These checks must not treat strings inside comments or raw-text elements as
 * real metadata/document structure. This is intentionally not a renderer: it
 * only recognizes start/end tags, quoted attributes, <head> metadata, Robin's
 * canonical article marker, and legacy JSON script elements.
 */

const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

function lineAtOffset(content, offset) {
  return content.slice(0, offset).split("\n").length;
}

function decodeNumericReference(number, radix) {
  const codePoint = Number.parseInt(number, radix);
  if (
    !Number.isInteger(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return "\uFFFD";
  }
  return String.fromCodePoint(codePoint);
}

function decodeHtmlAttribute(value) {
  return value
    .replace(/&#(\d+);/g, (_match, number) =>
      decodeNumericReference(number, 10),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, number) =>
      decodeNumericReference(number, 16),
    )
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseAttributes(tag) {
  const attributes = new Map();
  const opening = /^<\s*[^\s/>]+/.exec(tag);
  const bodyStart = opening?.[0].length ?? 1;
  const bodyEnd = tag.endsWith(">") ? tag.length - 1 : tag.length;
  const body = tag.slice(bodyStart, bodyEnd);
  const attributePattern =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = attributePattern.exec(body);
  while (match !== null) {
    attributes.set(
      match[1].toLowerCase(),
      decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? ""),
    );
    match = attributePattern.exec(body);
  }
  return attributes;
}

function tagEnd(html, start) {
  let quote = null;
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  return html.length;
}

function rawTextClosingOffset(lowerHtml, name, from) {
  const needle = `</${name}`;
  let offset = lowerHtml.indexOf(needle, from);
  while (offset >= 0) {
    const boundary = lowerHtml[offset + needle.length];
    if (boundary === undefined || /[\s/>]/.test(boundary)) return offset;
    offset = lowerHtml.indexOf(needle, offset + needle.length);
  }
  return -1;
}

export function parseHtmlContract(html) {
  const robinMeta = new Map();
  const lowerHtml = html.toLowerCase();
  let articleDataRobinDocCount = 0;
  let legacyJsonScriptLine = null;
  let headDepth = 0;
  let templateDepth = 0;
  let offset = 0;

  while (offset < html.length) {
    const start = html.indexOf("<", offset);
    if (start < 0) break;

    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      offset = end < 0 ? html.length : end + 3;
      continue;
    }

    const end = tagEnd(html, start);
    const tag = html.slice(start, end);
    const nameMatch = /^<\s*(\/?)\s*([a-z][a-z0-9:-]*)/i.exec(tag);
    if (!nameMatch) {
      offset = end;
      continue;
    }

    const closing = nameMatch[1] === "/";
    const name = nameMatch[2].toLowerCase();
    if (closing) {
      if (name === "template" && templateDepth > 0) {
        templateDepth -= 1;
      } else if (templateDepth === 0 && name === "head") {
        headDepth = Math.max(0, headDepth - 1);
      }
      offset = end;
      continue;
    }

    const attributes = parseAttributes(tag);
    if (name === "template") {
      templateDepth += 1;
      offset = end;
      continue;
    }
    if (templateDepth > 0) {
      if (RAW_TEXT_ELEMENTS.has(name) && !/\/\s*>$/.test(tag)) {
        const closingOffset = rawTextClosingOffset(lowerHtml, name, end);
        offset = closingOffset < 0 ? html.length : closingOffset;
      } else {
        offset = end;
      }
      continue;
    }
    if (name === "head") headDepth += 1;
    if (name === "meta" && headDepth > 0) {
      const metaName = attributes.get("name")?.toLowerCase();
      if (metaName?.startsWith("robin:")) {
        const values = robinMeta.get(metaName) ?? [];
        values.push({
          content: attributes.get("content") ?? "",
          line: lineAtOffset(html, start),
        });
        robinMeta.set(metaName, values);
      }
    }
    if (name === "article" && attributes.has("data-robin-doc")) {
      articleDataRobinDocCount += 1;
    }
    if (
      name === "script" &&
      attributes.get("type")?.trim().toLowerCase() === "application/json" &&
      legacyJsonScriptLine === null
    ) {
      legacyJsonScriptLine = lineAtOffset(html, start);
    }

    if (RAW_TEXT_ELEMENTS.has(name) && !/\/\s*>$/.test(tag)) {
      const closingOffset = rawTextClosingOffset(lowerHtml, name, end);
      offset = closingOffset < 0 ? html.length : closingOffset;
    } else {
      offset = end;
    }
  }

  return {
    robinMeta,
    articleDataRobinDocCount,
    hasLegacyJsonScript: legacyJsonScriptLine !== null,
    legacyJsonScriptLine,
  };
}

export function robinMetaValues(html) {
  const values = new Map();
  for (const [name, entries] of parseHtmlContract(html).robinMeta) {
    values.set(
      name,
      entries.map((entry) => entry.content),
    );
  }
  return values;
}
