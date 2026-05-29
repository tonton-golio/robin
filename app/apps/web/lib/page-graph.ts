import type { RobinBlock, RobinInline } from '@robin/converter';

function inlineText(inlines: RobinInline[]): string {
  return inlines
    .map((inline) => {
      if (inline.kind === 'text' || inline.kind === 'code') return inline.text;
      if (inline.kind === 'lineBreak') return ' ';
      if (inline.kind === 'wikilink') return inline.alias ?? inline.slug;
      return inlineText(inline.content);
    })
    .join('');
}

export function blockInlineText(block: RobinBlock): string {
  if (block.kind === 'heading' || block.kind === 'paragraph') return inlineText(block.content);
  if (block.kind === 'codeBlock') return block.lang ? `${block.lang} code` : 'Code';
  if (block.kind === 'quote') return 'Quote';
  if (block.kind === 'callout') return block.title ?? block.calloutType;
  if (block.kind === 'table') return 'Table';
  if (block.kind === 'taskList') return 'Tasks';
  if (block.kind === 'bulletList' || block.kind === 'numberedList') return 'List';
  if (block.kind === 'image' || block.kind === 'embeddedImage') return block.alt ?? 'Image';
  if (block.kind === 'hubChildren') return `Hub children: ${block.query}`;
  return 'Section';
}
