import type {
  Root,
  Content,
  Paragraph,
  Heading,
  List,
  ListItem,
  Code,
  Blockquote,
  ThematicBreak,
  Table,
  TableRow,
  Image,
  PhrasingContent,
  Text,
  InlineCode,
  Emphasis,
  Strong,
  Delete,
  Link,
  Break,
  Html,
} from 'mdast';
import type {
  RobinBlock,
  RobinInline,
  RobinTaskItem,
} from './types.js';

interface MdWikilinkInline extends Omit<PhrasingContent, 'type'> {
  type: 'wikilink';
  slug: string;
  alias?: string;
  /** Set by remarkWikilink for `![[...]]` image embeds. */
  embed?: boolean;
}

/**
 * Convert an mdast Root to RobinBlock[].
 * Recognizes Obsidian-style callouts in blockquotes (first paragraph "[!type] title").
 */
export function mdastToBlocks(root: Root): RobinBlock[] {
  return root.children.map(convertBlock).filter((b): b is RobinBlock => b !== null);
}

function convertBlock(node: Content): RobinBlock | null {
  switch (node.type) {
    case 'heading':
      return {
        kind: 'heading',
        level: (node as Heading).depth,
        content: convertInlines((node as Heading).children),
      };
    case 'paragraph': {
      const para = node as Paragraph;
      // Detect embed-only paragraph: a single `![[...]]` embed wikilink.
      // The wikilink's `alias` (if any) is the author caption → image alt text.
      const first = para.children[0] as unknown as MdWikilinkInline | undefined;
      if (
        para.children.length === 1 &&
        first &&
        first.type === 'wikilink' &&
        first.embed === true
      ) {
        return { kind: 'embeddedImage', slug: first.slug, alt: first.alias };
      }
      return { kind: 'paragraph', content: convertInlines(para.children) };
    }
    case 'list': {
      const list = node as List;
      const items = list.children.map((li) => convertListItem(li));
      // Render as a taskList if ANY item is a checkbox item. Non-task items in a
      // mixed list keep their content with checked:null (rendered without a
      // checkbox) so the task items' checkbox state isn't silently dropped.
      if (items.some((i) => i.isTask)) {
        return {
          kind: 'taskList',
          items: items.map((i) => i.task),
        };
      }
      if (list.ordered) {
        return {
          kind: 'numberedList',
          items: items.map((i) => i.blocks),
          ...(list.start != null && list.start !== 1 ? { start: list.start } : {}),
        };
      }
      return { kind: 'bulletList', items: items.map((i) => i.blocks) };
    }
    case 'code': {
      const c = node as Code;
      return { kind: 'codeBlock', ...(c.lang ? { lang: c.lang } : {}), code: c.value };
    }
    case 'blockquote': {
      const bq = node as Blockquote;
      const callout = detectCallout(bq);
      if (callout) return callout;
      return {
        kind: 'quote',
        children: bq.children.map(convertBlock).filter((b): b is RobinBlock => b !== null),
      };
    }
    case 'thematicBreak':
      return { kind: 'thematicBreak' };
    case 'table': {
      const t = node as Table;
      const [headerRow, ...bodyRows] = t.children;
      if (!headerRow) return null;
      return {
        kind: 'table',
        headers: rowToInlines(headerRow),
        rows: bodyRows.map(rowToInlines),
      };
    }
    case 'html':
      // Preserve raw HTML blocks (rare in vault, but possible).
      return { kind: 'html', raw: (node as Html).value };
    default:
      // Unsupported block types (yaml, footnote, definition, etc.) — drop silently;
      // yaml is already stripped by gray-matter, definitions are stripped by remark.
      return null;
  }
}

function rowToInlines(row: TableRow): RobinInline[][] {
  return row.children.map((cell) => convertInlines(cell.children));
}

interface ListItemResult {
  isTask: boolean;
  /** Task-shaped view, always computed so a non-task item can join a mixed taskList (checked:null). */
  task: RobinTaskItem;
  blocks: RobinBlock[];
}

function convertListItem(li: ListItem): ListItemResult {
  const children = li.children.map(convertBlock).filter((b): b is RobinBlock => b !== null);
  const isTask = li.checked === true || li.checked === false;

  // Always extract the inline content of the first paragraph + any nested
  // children, so the item has a task-shaped representation even when it carries
  // no checkbox — needed when it shares a list with task items (mixed list).
  const first = children[0];
  let content: RobinInline[] = [];
  let rest: RobinBlock[] = [];
  if (first && first.kind === 'paragraph') {
    content = first.content;
    rest = children.slice(1);
  } else {
    rest = children;
  }
  const task: RobinTaskItem = {
    checked: isTask ? (li.checked as boolean) : null,
    content,
    ...(rest.length > 0 ? { children: rest } : {}),
  };
  return { isTask, task, blocks: children };
}

// Matches only the callout marker: `[!type]` with optional `-` collapse flag and
// trailing whitespace. The title text itself is NOT captured here — it may carry
// inline formatting (bold/links/wikilinks/code) that lives in sibling mdast nodes,
// so we collect the whole title line by splitting children at the first newline.
const CALLOUT_RE = /^\[!([a-zA-Z]+)\](-)?[ \t]*/;

function detectCallout(bq: Blockquote): RobinBlock | null {
  const first = bq.children[0];
  if (!first || first.type !== 'paragraph') return null;
  const para = first as Paragraph;
  const firstChild = para.children[0];
  if (!firstChild || firstChild.type !== 'text') return null;
  const textNode = firstChild as Text;
  const match = textNode.value.match(CALLOUT_RE);
  if (!match) return null;

  const [whole, type, collapsedMarker] = match;
  const matchEnd = whole.length;

  // The first paragraph mixes the title line and (optionally) the first body line,
  // separated by a soft line-break that survives inside a text node as `\n`. The
  // title line can include formatted siblings (bold/links/wikilinks/code), so we
  // can't rely on a flat regex capture — instead we split the paragraph children
  // at the first newline: everything before it is title, everything after is body.
  const titleInlines: PhrasingContent[] = [];
  const bodyInlines: PhrasingContent[] = [];

  // First text node: strip the `[!type]` prefix, then split on the first newline.
  const firstRest = textNode.value.slice(matchEnd);
  const nlInFirst = firstRest.indexOf('\n');
  let splitReached = nlInFirst !== -1;
  if (splitReached) {
    const titlePart = firstRest.slice(0, nlInFirst);
    const bodyPart = firstRest.slice(nlInFirst + 1);
    if (titlePart.length > 0) titleInlines.push({ type: 'text', value: titlePart } as Text);
    if (bodyPart.length > 0) bodyInlines.push({ type: 'text', value: bodyPart } as Text);
  } else if (firstRest.length > 0) {
    titleInlines.push({ type: 'text', value: firstRest } as Text);
  }

  // Remaining siblings: those before the first newline belong to the title; a
  // `break` node or a text node containing `\n` marks the title→body boundary.
  for (let i = 1; i < para.children.length; i++) {
    const c = para.children[i];
    if (!c) continue;
    if (splitReached) {
      bodyInlines.push(c);
      continue;
    }
    if (c.type === 'break') {
      // Hard line-break ends the title line; the break itself is dropped.
      splitReached = true;
      continue;
    }
    if (c.type === 'text') {
      const v = (c as Text).value;
      const nl = v.indexOf('\n');
      if (nl !== -1) {
        const titlePart = v.slice(0, nl);
        const bodyPart = v.slice(nl + 1);
        if (titlePart.length > 0) titleInlines.push({ type: 'text', value: titlePart } as Text);
        if (bodyPart.length > 0) bodyInlines.push({ type: 'text', value: bodyPart } as Text);
        splitReached = true;
        continue;
      }
    }
    titleInlines.push(c);
  }

  // Title is a plain string in the block model — flatten any inline formatting.
  const title = plainTextOfInlines(titleInlines).trim();

  const bodyBlocks: RobinBlock[] = [];
  if (bodyInlines.length > 0) {
    const converted = convertInlines(bodyInlines);
    if (converted.length > 0) {
      bodyBlocks.push({ kind: 'paragraph', content: converted });
    }
  }
  // Remaining blockquote children are additional callout body.
  for (let i = 1; i < bq.children.length; i++) {
    const child = bq.children[i];
    if (!child) continue;
    const b = convertBlock(child as Content);
    if (b) bodyBlocks.push(b);
  }

  return {
    kind: 'callout',
    calloutType: type!.toLowerCase(),
    ...(collapsedMarker ? { collapsed: true } : {}),
    ...(title ? { title } : {}),
    children: bodyBlocks,
  };
}

/** Flatten phrasing content to plain text (drops formatting; keeps visible text). */
function plainTextOfInlines(nodes: PhrasingContent[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') {
      out += (n as Text).value;
    } else if (n.type === 'inlineCode') {
      out += (n as InlineCode).value;
    } else if ((n as { type: string }).type === 'wikilink') {
      const w = n as unknown as { slug: string; alias?: string };
      out += w.alias ?? w.slug;
    } else if ('children' in n && Array.isArray((n as { children?: unknown[] }).children)) {
      out += plainTextOfInlines((n as { children: PhrasingContent[] }).children);
    }
  }
  return out;
}

// ── Inline conversion ────────────────────────────────────────────────────────

function convertInlines(nodes: PhrasingContent[]): RobinInline[] {
  const out: RobinInline[] = [];
  for (const n of nodes) {
    const result = convertInline(n);
    if (Array.isArray(result)) out.push(...result);
    else if (result) out.push(result);
  }
  return mergeAdjacentText(out);
}

function convertInline(node: PhrasingContent): RobinInline | RobinInline[] | null {
  switch (node.type) {
    case 'text':
      return { kind: 'text', text: (node as Text).value };
    case 'inlineCode':
      return { kind: 'code', text: (node as InlineCode).value };
    case 'emphasis':
      return addMark(convertInlines((node as Emphasis).children), 'italic');
    case 'strong':
      return addMark(convertInlines((node as Strong).children), 'bold');
    case 'delete':
      return addMark(convertInlines((node as Delete).children), 'strike');
    case 'break':
      return { kind: 'lineBreak' };
    case 'link': {
      const l = node as Link;
      return { kind: 'link', href: l.url, content: convertInlines(l.children) };
    }
    case 'image': {
      const img = node as Image;
      // Inline image (rare in this vault) — wrap as a synthetic embeddedImage placeholder.
      // We can't return a block here; turn it into a link-styled inline for now.
      return { kind: 'link', href: img.url, content: [{ kind: 'text', text: img.alt || img.url }] };
    }
    case 'wikilink' as 'text': {
      const w = node as unknown as { type: 'wikilink'; slug: string; alias?: string; embed?: boolean };
      // Embeds bubble up as blocks; here we shouldn't see them in inline context,
      // but if we do (e.g. inside a table cell), render as a link to the embed target.
      if (w.embed === true) {
        return { kind: 'link', href: w.slug, content: [{ kind: 'text', text: w.alias ?? w.slug }] };
      }
      return { kind: 'wikilink', slug: w.slug, ...(w.alias ? { alias: w.alias } : {}) };
    }
    default:
      return null;
  }
}

function addMark(inlines: RobinInline[], mark: 'bold' | 'italic' | 'strike'): RobinInline[] {
  return inlines.map((inline) => {
    // text, wikilink and code all carry their own `marks`; merge in this one so
    // emphasis wrapping a wikilink or inline code (`**[[page]]**`, `` **`x`** ``)
    // is not lost on conversion.
    if (inline.kind === 'text' || inline.kind === 'wikilink' || inline.kind === 'code') {
      const marks = inline.marks ? [...inline.marks, mark] : [mark];
      // Deduplicate and sort marks for canonical form
      const uniq = [...new Set(marks)].sort();
      return { ...inline, marks: uniq as ('bold' | 'italic' | 'strike')[] };
    }
    if (inline.kind === 'link') {
      return { ...inline, content: addMark(inline.content, mark) };
    }
    return inline;
  });
}

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
