import type { RobinBlock, RobinInline, RobinTaskItem } from '@robin/converter';

function inlineLinks(inlines: RobinInline[], slugs: Set<string>): void {
  for (const inline of inlines) {
    if (inline.kind === 'wikilink') {
      slugs.add(inline.slug);
    } else if ('content' in inline && Array.isArray(inline.content)) {
      inlineLinks(inline.content, slugs);
    }
  }
}

function blockLinks(block: RobinBlock, slugs: Set<string>): void {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      inlineLinks(block.content, slugs);
      break;
    case 'bulletList':
    case 'numberedList':
      block.items.flat().forEach((child) => blockLinks(child, slugs));
      break;
    case 'taskList':
      block.items.forEach((item: RobinTaskItem) => {
        inlineLinks(item.content, slugs);
        item.children?.forEach((child) => blockLinks(child, slugs));
      });
      break;
    case 'quote':
    case 'callout':
      block.children.forEach((child) => blockLinks(child, slugs));
      break;
    case 'table':
      block.headers.forEach((cell) => inlineLinks(cell, slugs));
      block.rows.flat().forEach((cell) => inlineLinks(cell, slugs));
      break;
    default:
      break;
  }
}

export function linksFromBlocks(blocks: RobinBlock[]): string[] {
  const slugs = new Set<string>();
  blocks.forEach((block) => blockLinks(block, slugs));
  return Array.from(slugs).sort((a, b) => a.localeCompare(b));
}
