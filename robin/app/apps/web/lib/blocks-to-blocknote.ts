/**
 * RobinBlock[] → BlockNote PartialBlock[]
 *
 * Maps our intermediate representation to BlockNote's block tree for editor loading.
 * BlockNote will assign its own transient `id` fields on load.
 *
 * We use `any` for BlockNote internals to avoid complex generic type plumbing —
 * the runtime behavior is correct and the types are exercised at the JS level.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { RobinBlock, RobinInline } from '@robin/converter';

// ── Public entry point ────────────────────────────────────────────────────────

export function robinBlocksToBlockNote(blocks: RobinBlock[]): any[] {
  const result: any[] = [];
  for (const block of blocks) {
    const converted = convertBlock(block);
    if (Array.isArray(converted)) {
      result.push(...converted);
    } else if (converted) {
      result.push(converted);
    }
  }
  // BlockNote requires at least one block
  if (result.length === 0) {
    result.push({ type: 'paragraph', content: [] });
  }
  return result;
}

// ── Block conversion ──────────────────────────────────────────────────────────

function convertBlock(block: RobinBlock): any | any[] | null {
  switch (block.kind) {
    case 'heading':
      return {
        type: 'heading',
        // Emit the true level (1–6). Previously this clamped to 3, silently
        // downgrading h4–h6 on every editor round-trip. When the BlockNote
        // editor is wired up, its schema must enable `heading: { levels:
        // [1,2,3,4,5,6] }` (the bundled default caps at 3) so h4–h6 survive.
        props: { level: block.level },
        content: convertInlines(block.content),
      };

    case 'paragraph':
      return {
        type: 'paragraph',
        content: convertInlines(block.content),
      };

    case 'bulletList': {
      return block.items.map((itemBlocks) => ({
        type: 'bulletListItem',
        content: convertItemContent(itemBlocks),
        children: convertNestedBlocks(itemBlocks),
      }));
    }

    case 'numberedList': {
      return block.items.map((itemBlocks, i) => ({
        type: 'numberedListItem',
        // Carry the list's `start` on the first item (where BlockNote reads it)
        // so a list beginning at e.g. 5 doesn't reset to 1 on round-trip.
        ...(i === 0 && block.start !== undefined ? { props: { start: block.start } } : {}),
        content: convertItemContent(itemBlocks),
        children: convertNestedBlocks(itemBlocks),
      }));
    }

    case 'taskList': {
      return block.items.map((item) => ({
        type: 'checkListItem',
        props: { checked: item.checked },
        content: convertInlines(item.content),
        children: item.children
          ? (item.children.flatMap((c) => {
              const r = convertBlock(c);
              return Array.isArray(r) ? r : r ? [r] : [];
            }) as any[])
          : [],
      }));
    }

    case 'codeBlock':
      return {
        type: 'codeBlock',
        props: { language: block.lang ?? '' },
        content: [{ type: 'text', text: block.code, styles: {} }],
      };

    case 'quote': {
      const children = block.children.flatMap((c) => {
        const r = convertBlock(c);
        return Array.isArray(r) ? r : r ? [r] : [];
      }) as any[];
      if (children.length === 0) {
        return { type: 'paragraph', content: [] };
      }
      const [first, ...rest] = children;
      return {
        ...first,
        children: [...(first?.children ?? []), ...rest],
      };
    }

    case 'callout': {
      const childBlocks = block.children.flatMap((c) => {
        const r = convertBlock(c);
        return Array.isArray(r) ? r : r ? [r] : [];
      }) as any[];

      const titleText = block.title
        ? `[!${block.calloutType}] ${block.title}`
        : `[!${block.calloutType}]`;
      const titleBlock = {
        type: 'paragraph',
        content: [{ type: 'text', text: titleText, styles: { bold: true } }],
      };

      return [titleBlock, ...childBlocks];
    }

    case 'image':
      return {
        type: 'image',
        props: {
          url: block.src,
          caption: block.alt ?? '',
          previewWidth: 512,
        },
      };

    case 'embeddedImage':
      return {
        type: 'image',
        props: {
          url: '',
          caption: block.alt ?? block.slug,
          previewWidth: 512,
        },
      };

    case 'thematicBreak':
      return { type: 'paragraph', content: [{ type: 'text', text: '---', styles: {} }] };

    case 'table':
      return {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            { cells: block.headers.map((h) => convertInlines(h)) },
            ...block.rows.map((row) => ({
              cells: row.map((cell) => convertInlines(cell)),
            })),
          ],
        },
      };

    case 'hubChildren':
      return {
        type: 'paragraph',
        content: [{ type: 'text', text: `[hub: ${block.query}]`, styles: { italic: true } }],
      };

    case 'html':
      return {
        type: 'paragraph',
        content: [{ type: 'text', text: block.raw, styles: {} }],
      };

    default:
      return null;
  }
}

// ── Item content helpers ──────────────────────────────────────────────────────

function convertItemContent(itemBlocks: RobinBlock[]): any[] {
  if (itemBlocks.length > 0 && itemBlocks[0]?.kind === 'paragraph') {
    return convertInlines(itemBlocks[0].content);
  }
  return [];
}

function convertNestedBlocks(itemBlocks: RobinBlock[]): any[] {
  const rest =
    itemBlocks.length > 0 && itemBlocks[0]?.kind === 'paragraph'
      ? itemBlocks.slice(1)
      : itemBlocks;
  return rest.flatMap((b) => {
    const r = convertBlock(b);
    return Array.isArray(r) ? r : r ? [r] : [];
  });
}

// ── Inline conversion ─────────────────────────────────────────────────────────

function convertInlines(inlines: RobinInline[]): any[] {
  return inlines.map(convertInline).filter(Boolean);
}

function convertInline(inline: RobinInline): any | null {
  switch (inline.kind) {
    case 'text': {
      const styles: Record<string, boolean> = {};
      for (const mark of inline.marks ?? []) {
        if (mark === 'bold') styles['bold'] = true;
        if (mark === 'italic') styles['italic'] = true;
        if (mark === 'strike') styles['strikethrough'] = true;
      }
      return { type: 'text', text: inline.text, styles };
    }

    case 'code':
      return { type: 'text', text: inline.text, styles: { code: true } };

    case 'lineBreak':
      return { type: 'text', text: '\n', styles: {} };

    case 'link': {
      const content = convertInlines(inline.content);
      return {
        type: 'link',
        href: inline.href,
        content: content.filter((c: any) => c.type === 'text'),
      };
    }

    case 'wikilink': {
      const label = inline.alias ?? inline.slug;
      return {
        type: 'link',
        href: `/p/${inline.slug}`,
        content: [{ type: 'text', text: label, styles: {} }],
      };
    }

    default:
      return null;
  }
}
