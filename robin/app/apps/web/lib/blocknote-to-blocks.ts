/**
 * BlockNote Block[] → RobinBlock[]
 *
 * Converts the editor's live block tree back to our stable intermediate format.
 * Block `id` fields are intentionally NOT included — they're stripped at this step.
 *
 * We use `any` for BlockNote internals to avoid complex generic type plumbing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { RobinBlock, RobinInline, RobinMark } from '@robin/converter';

// ── Public entry point ────────────────────────────────────────────────────────

export function blockNoteToRobinBlocks(blocks: any[]): RobinBlock[] {
  return blocks.flatMap(convertBlock).filter(Boolean) as RobinBlock[];
}

// ── Block conversion ──────────────────────────────────────────────────────────

function convertBlock(block: any): RobinBlock | RobinBlock[] | null {
  const type: string = block.type ?? '';

  switch (type) {
    case 'heading': {
      const level = (block.props?.level as number) ?? 1;
      return {
        kind: 'heading',
        level: Math.min(6, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5 | 6,
        content: convertInlineContent(block.content ?? []),
      };
    }

    case 'paragraph':
      return {
        kind: 'paragraph',
        content: convertInlineContent(block.content ?? []),
      };

    case 'bulletListItem': {
      const children = block.children?.length
        ? blockNoteToRobinBlocks(block.children as any[])
        : [];
      const content = convertInlineContent(block.content ?? []);
      const itemBlocks: RobinBlock[] = [
        { kind: 'paragraph', content },
        ...children,
      ];
      return { kind: 'bulletList', items: [itemBlocks] };
    }

    case 'numberedListItem': {
      const children = block.children?.length
        ? blockNoteToRobinBlocks(block.children as any[])
        : [];
      const content = convertInlineContent(block.content ?? []);
      const itemBlocks: RobinBlock[] = [
        { kind: 'paragraph', content },
        ...children,
      ];
      // Preserve a non-default start (1 is the default, so it's left implicit).
      // mergeListBlocks keeps the first block's start when merging items.
      const start = typeof block.props?.start === 'number' ? block.props.start : undefined;
      return start !== undefined && start !== 1
        ? { kind: 'numberedList', items: [itemBlocks], start }
        : { kind: 'numberedList', items: [itemBlocks] };
    }

    case 'checkListItem': {
      const checked = Boolean(block.props?.checked);
      const content = convertInlineContent(block.content ?? []);
      return {
        kind: 'taskList',
        items: [{ checked, content }],
      };
    }

    case 'codeBlock': {
      const language = (block.props?.language as string) ?? '';
      const textContent = extractPlainText(block.content ?? []);
      return {
        kind: 'codeBlock',
        lang: language || undefined,
        code: textContent,
      };
    }

    case 'image': {
      const url = String(block.props?.url ?? '');
      const caption = String(block.props?.caption ?? '');
      return {
        kind: 'image',
        src: url,
        alt: caption || undefined,
      };
    }

    case 'table': {
      const tableContent = block.content;
      if (!tableContent?.rows?.length) {
        return { kind: 'paragraph', content: [] };
      }
      const [headerRow, ...dataRows] = tableContent.rows as Array<{ cells: any[][] }>;
      return {
        kind: 'table',
        headers: (headerRow?.cells ?? []).map((cell: any) =>
          convertInlineContent(cell)
        ),
        rows: dataRows.map((row) =>
          row.cells.map((cell: any) => convertInlineContent(cell))
        ),
      };
    }

    default:
      // Unknown block type — render as paragraph
      return {
        kind: 'paragraph',
        content: convertInlineContent(block.content ?? []),
      };
  }
}

// ── Inline conversion ─────────────────────────────────────────────────────────

function convertInlineContent(content: any[]): RobinInline[] {
  if (!content) return [];
  return content.flatMap(convertInline).filter(Boolean) as RobinInline[];
}

function convertInline(inline: any): RobinInline | RobinInline[] | null {
  const type: string = inline?.type ?? '';

  switch (type) {
    case 'text': {
      const styles: Record<string, unknown> = inline.styles ?? {};
      const marks: RobinMark[] = [];
      if (styles['bold']) marks.push('bold');
      if (styles['italic']) marks.push('italic');
      if (styles['strikethrough']) marks.push('strike');

      if (styles['code']) {
        return { kind: 'code', text: inline.text as string };
      }

      return {
        kind: 'text',
        text: inline.text as string,
        marks: marks.length > 0 ? marks : undefined,
      };
    }

    case 'link': {
      const href: string = inline.href ?? '';

      // Detect wikilinks by our /p/ prefix convention
      if (href.startsWith('/p/')) {
        const slug = href.slice(3); // strip /p/
        const label = (inline.content as any[]).map((c: any) => String(c.text ?? '')).join('');
        return {
          kind: 'wikilink',
          slug,
          alias: label !== slug ? label : undefined,
        };
      }

      return {
        kind: 'link',
        href,
        content: (inline.content as any[]).map((c: any) => ({
          kind: 'text' as const,
          text: String(c.text ?? ''),
          marks: buildMarks(c.styles ?? {}),
        })),
      };
    }

    default:
      return null;
  }
}

function buildMarks(styles: Record<string, unknown>): RobinMark[] | undefined {
  const marks: RobinMark[] = [];
  if (styles['bold']) marks.push('bold');
  if (styles['italic']) marks.push('italic');
  if (styles['strikethrough']) marks.push('strike');
  return marks.length > 0 ? marks : undefined;
}

function extractPlainText(content: any[]): string {
  if (!content) return '';
  return content
    .map((c: any) => (c.type === 'text' ? String(c.text ?? '') : ''))
    .join('');
}

// ── Post-processing: merge adjacent same-kind list blocks ─────────────────────

/**
 * BlockNote emits one list block per item. Merge adjacent same-kind lists
 * into a single RobinBlock with multiple items.
 */
export function mergeListBlocks(blocks: RobinBlock[]): RobinBlock[] {
  const result: RobinBlock[] = [];

  for (const block of blocks) {
    const prev = result[result.length - 1];

    if (block.kind === 'bulletList' && prev?.kind === 'bulletList') {
      prev.items.push(...block.items);
      continue;
    }

    if (block.kind === 'numberedList' && prev?.kind === 'numberedList') {
      prev.items.push(...block.items);
      continue;
    }

    if (block.kind === 'taskList' && prev?.kind === 'taskList') {
      prev.items.push(...block.items);
      continue;
    }

    result.push(block);
  }

  return result;
}
