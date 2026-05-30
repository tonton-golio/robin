import type { RobinBlock, RobinInline } from './types.js';

/**
 * Render RobinBlock[] to an HTML string for the <body> contents.
 * Output is canonical — stable across runs given the same input.
 */
export function blocksToBodyHtml(blocks: RobinBlock[]): string {
  return blocks.map(renderBlock).join('\n');
}

function renderBlock(block: RobinBlock): string {
  switch (block.kind) {
    case 'heading':
      return `<h${block.level}>${renderInlines(block.content)}</h${block.level}>`;
    case 'paragraph':
      return `<p>${renderInlines(block.content)}</p>`;
    case 'bulletList':
      return `<ul data-block="bulletList">${block.items
        .map((blocks) => `<li>${renderItemContent(blocks)}</li>`)
        .join('')}</ul>`;
    case 'numberedList': {
      const startAttr = block.start != null && block.start !== 1 ? ` start="${block.start}"` : '';
      return `<ol data-block="numberedList"${startAttr}>${block.items
        .map((blocks) => `<li>${renderItemContent(blocks)}</li>`)
        .join('')}</ol>`;
    }
    case 'taskList':
      return `<ul data-block="taskList">${block.items
        .map((item) => {
          const inner = `${renderInlines(item.content)}${
            item.children ? renderChildren(item.children) : ''
          }`;
          // A null `checked` is a plain (non-checkbox) item sharing a mixed list
          // with task items — emit a bare <li> without the task checkbox attrs.
          if (item.checked === null) return `<li>${inner}</li>`;
          return `<li data-block="task" data-checked="${item.checked ? 'true' : 'false'}">${inner}</li>`;
        })
        .join('')}</ul>`;
    case 'codeBlock': {
      const langAttr = block.lang ? ` data-lang="${escapeAttr(block.lang)}"` : '';
      return `<pre${langAttr}><code>${escapeText(block.code)}</code></pre>`;
    }
    case 'quote':
      return `<blockquote>${block.children.map(renderBlock).join('')}</blockquote>`;
    case 'callout': {
      const attrs: string[] = [`data-callout="${escapeAttr(block.calloutType)}"`];
      if (block.collapsed) attrs.push('data-collapsed="true"');
      const titleHtml = block.title
        ? `<header data-block="calloutTitle">${escapeText(block.title)}</header>`
        : '';
      const sortedAttrs = attrs.sort().join(' ');
      return `<aside ${sortedAttrs}>${titleHtml}${block.children.map(renderBlock).join('')}</aside>`;
    }
    case 'image':
      return `<figure data-embed="image"><img alt="${escapeAttr(
        block.alt || '',
      )}" src="${escapeAttr(block.src)}"></figure>`;
    case 'embeddedImage':
      return `<figure data-embed="image"><img alt="${escapeAttr(
        block.alt || '',
      )}" data-wiki="${escapeAttr(block.slug)}" src=""></figure>`;
    case 'hubChildren':
      return `<ul data-block="hubChildren" data-query="${escapeAttr(block.query)}"></ul>`;
    case 'thematicBreak':
      return `<hr>`;
    case 'table': {
      const cols = block.headers.length;
      const headHtml = `<thead><tr>${block.headers
        .map((h) => `<th>${renderInlines(h)}</th>`)
        .join('')}</tr></thead>`;
      // Normalize each body row to the header column count: pad short rows with
      // empty <td> and drop any overflow cells so the table stays rectangular
      // (GFM/mdast can leave ragged rows un-padded).
      const bodyHtml = `<tbody>${block.rows
        .map((row) => {
          const cells: string[] = [];
          for (let i = 0; i < cols; i++) {
            cells.push(`<td>${row[i] ? renderInlines(row[i]!) : ''}</td>`);
          }
          return `<tr>${cells.join('')}</tr>`;
        })
        .join('')}</tbody>`;
      return `<table>${headHtml}${bodyHtml}</table>`;
    }
    case 'html':
      return block.raw;
  }
}

function renderItemContent(blocks: RobinBlock[]): string {
  // Inline-collapse: if the only child is a paragraph, render just its inlines.
  if (blocks.length === 1 && blocks[0]!.kind === 'paragraph') {
    return renderInlines(blocks[0]!.content);
  }
  // If first is paragraph, render its inlines, then render the rest as blocks.
  if (blocks.length > 0 && blocks[0]!.kind === 'paragraph') {
    return renderInlines(blocks[0]!.content) + blocks.slice(1).map(renderBlock).join('');
  }
  return blocks.map(renderBlock).join('');
}

function renderChildren(blocks: RobinBlock[]): string {
  return blocks.map(renderBlock).join('');
}

function renderInlines(inlines: RobinInline[]): string {
  return inlines.map(renderInline).join('');
}

function renderInline(inline: RobinInline): string {
  switch (inline.kind) {
    case 'text':
      return wrapMarks(escapeText(inline.text), inline.marks);
    case 'code':
      return wrapMarks(`<code>${escapeText(inline.text)}</code>`, inline.marks);
    case 'lineBreak':
      return `<br>`;
    case 'link':
      return `<a href="${escapeAttr(inline.href)}">${renderInlines(inline.content)}</a>`;
    case 'wikilink': {
      // data-wiki is canonical; href is derived (just a placeholder until resolver runs).
      const label = inline.alias ?? inline.slug;
      const attrs: string[] = [
        `data-wiki="${escapeAttr(inline.slug)}"`,
        `href="/p/${escapeAttr(inline.slug)}"`,
      ];
      sortAttrsAlpha(attrs);
      return wrapMarks(`<a ${attrs.join(' ')}>${escapeText(label)}</a>`, inline.marks);
    }
  }
}

function wrapMarks(text: string, marks?: ('bold' | 'italic' | 'strike')[]): string {
  if (!marks || marks.length === 0) return text;
  // Sort marks alphabetically for canonical wrapping order: bold > italic > strike
  // Wrap inside-out so output is stable regardless of input order.
  const order: Record<'bold' | 'italic' | 'strike', number> = { bold: 0, italic: 1, strike: 2 };
  const sorted = [...marks].sort((a, b) => order[a] - order[b]);
  let out = text;
  for (const m of sorted.slice().reverse()) {
    if (m === 'bold') out = `<strong>${out}</strong>`;
    else if (m === 'italic') out = `<em>${out}</em>`;
    else if (m === 'strike') out = `<s>${out}</s>`;
  }
  return out;
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sortAttrsAlpha(attrs: string[]): void {
  attrs.sort((a, b) => {
    const an = a.split('=')[0]!;
    const bn = b.split('=')[0]!;
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}
