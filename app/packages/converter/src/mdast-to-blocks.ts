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
      // Detect embed-only paragraph: a single wikilink with alias='embed'.
      const first = para.children[0] as unknown as MdWikilinkInline | undefined;
      if (
        para.children.length === 1 &&
        first &&
        first.type === 'wikilink' &&
        first.alias === 'embed'
      ) {
        return { kind: 'embeddedImage', slug: first.slug, alt: undefined };
      }
      return { kind: 'paragraph', content: convertInlines(para.children) };
    }
    case 'list': {
      const list = node as List;
      const items = list.children.map((li) => convertListItem(li));
      if (items.every((i) => i.isTask)) {
        return {
          kind: 'taskList',
          items: items.map((i) => i.task!),
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
  task?: RobinTaskItem;
  blocks: RobinBlock[];
}

function convertListItem(li: ListItem): ListItemResult {
  const children = li.children.map(convertBlock).filter((b): b is RobinBlock => b !== null);

  if (li.checked === true || li.checked === false) {
    // Task item: extract inline content of first paragraph; preserve any nested children.
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
      checked: li.checked,
      content,
      ...(rest.length > 0 ? { children: rest } : {}),
    };
    return { isTask: true, task, blocks: children };
  }
  return { isTask: false, blocks: children };
}

// Matches the first line of a callout header. Anchored to start; capture stops at newline.
const CALLOUT_RE = /^\[!([a-zA-Z]+)\](-)?\s*([^\n]*)/;

function detectCallout(bq: Blockquote): RobinBlock | null {
  const first = bq.children[0];
  if (!first || first.type !== 'paragraph') return null;
  const para = first as Paragraph;
  const firstChild = para.children[0];
  if (!firstChild || firstChild.type !== 'text') return null;
  const textNode = firstChild as Text;
  const match = textNode.value.match(CALLOUT_RE);
  if (!match) return null;

  const [whole, type, collapsedMarker, titleText] = match;
  const matchEnd = whole.length;
  // Everything in the first text node after the header line is callout body text.
  const trailingText = textNode.value.slice(matchEnd).replace(/^\n/, '');

  // Build the body inline list. Subsequent siblings of the first text node carry
  // formatted content (links, emphasis, wikilinks, etc.) from later lines.
  const bodyInlines: PhrasingContent[] = [];
  if (trailingText.length > 0) {
    bodyInlines.push({ type: 'text', value: trailingText } as Text);
  }
  for (let i = 1; i < para.children.length; i++) {
    const c = para.children[i];
    if (c) bodyInlines.push(c);
  }

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
    ...(titleText && titleText.trim() ? { title: titleText.trim() } : {}),
    children: bodyBlocks,
  };
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
      const w = node as unknown as { type: 'wikilink'; slug: string; alias?: string };
      // Embeds bubble up as blocks; here we shouldn't see them in inline context,
      // but if we do (e.g. inside table cell), render as a link to the embed target.
      if (w.alias === 'embed') {
        return { kind: 'link', href: w.slug, content: [{ kind: 'text', text: w.slug }] };
      }
      return { kind: 'wikilink', slug: w.slug, ...(w.alias ? { alias: w.alias } : {}) };
    }
    default:
      return null;
  }
}

function addMark(inlines: RobinInline[], mark: 'bold' | 'italic' | 'strike'): RobinInline[] {
  return inlines.map((inline) => {
    if (inline.kind === 'text') {
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
