/**
 * RobinBlock[] → React tree.
 * Parallel to packages/converter/src/blocks-to-html.ts but produces JSX.
 *
 * Wikilinks are rendered as <WikiLink> components which handle
 * resolved/broken/archived states using a provided slug→path map.
 */

import React from 'react';
import Link from 'next/link';
import type { RobinBlock, RobinInline, RobinTaskItem } from '@robin/converter';
import { vaultPageHref } from '@/lib/routes';

export interface WikiLinkMap {
  /** slug → vault-relative file path (without .html) */
  resolve: (slug: string) => { path: string; archived: boolean } | null;
}

interface RenderCtx {
  wikimap: WikiLinkMap;
}

// ── Public entry point ────────────────────────────────────────────────────────

export function blocksToReactNodes(
  blocks: RobinBlock[],
  wikimap: WikiLinkMap,
): React.ReactNode {
  const ctx: RenderCtx = { wikimap };
  return blocks.map((b, i) => renderBlock(b, ctx, i));
}

// ── Block renderers ───────────────────────────────────────────────────────────

function renderBlock(block: RobinBlock, ctx: RenderCtx, key: number | string): React.ReactNode {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return <Tag key={key}>{renderInlines(block.content, ctx)}</Tag>;
    }

    case 'paragraph':
      return <p key={key}>{renderInlines(block.content, ctx)}</p>;

    case 'bulletList':
      return (
        <ul data-block="bulletList" key={key}>
          {block.items.map((itemBlocks, i) => (
            <li key={i}>{renderItemContent(itemBlocks, ctx)}</li>
          ))}
        </ul>
      );

    case 'numberedList': {
      const startProp = block.start != null && block.start !== 1 ? { start: block.start } : {};
      return (
        <ol data-block="numberedList" key={key} {...startProp}>
          {block.items.map((itemBlocks, i) => (
            <li key={i}>{renderItemContent(itemBlocks, ctx)}</li>
          ))}
        </ol>
      );
    }

    case 'taskList':
      return (
        <ul data-block="taskList" key={key}>
          {block.items.map((item: RobinTaskItem, i: number) => (
            <li
              key={i}
              data-block="task"
              data-checked={item.checked ? 'true' : 'false'}
            >
              {renderInlines(item.content, ctx)}
              {item.children && item.children.length > 0 && (
                <div>{item.children.map((c, ci) => renderBlock(c, ctx, ci))}</div>
              )}
            </li>
          ))}
        </ul>
      );

    case 'codeBlock':
      return (
        <pre key={key} data-lang={block.lang}>
          <code>{block.code}</code>
        </pre>
      );

    case 'quote':
      return (
        <blockquote key={key}>
          {block.children.map((c, i) => renderBlock(c, ctx, i))}
        </blockquote>
      );

    case 'callout': {
      const asideProps: Record<string, unknown> = { 'data-callout': block.calloutType };
      if (block.collapsed) asideProps['data-collapsed'] = 'true';
      return (
        <aside key={key} {...asideProps}>
          {block.title && (
            <header data-block="calloutTitle">{block.title}</header>
          )}
          {block.children.map((c, i) => renderBlock(c, ctx, i))}
        </aside>
      );
    }

    case 'image':
      return (
        <figure key={key} data-embed="image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.src} alt={block.alt ?? ''} />
        </figure>
      );

    case 'embeddedImage': {
      // Embedded image by slug — src not resolved in phase 2
      return (
        <figure key={key} data-embed="image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img data-wiki={block.slug} src="" alt={block.alt ?? block.slug} />
        </figure>
      );
    }

    case 'hubChildren':
      // Render a placeholder; the HubChildren component fills this client-side
      return <HubChildrenBlock key={key} query={block.query} ctx={ctx} />;

    case 'thematicBreak':
      return <hr key={key} />;

    case 'table':
      return (
        <table key={key}>
          <thead>
            <tr>
              {block.headers.map((h, i) => (
                <th key={i}>{renderInlines(h, ctx)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{renderInlines(cell, ctx)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );

    case 'html':
      // Raw HTML block — use dangerouslySetInnerHTML (trusted source)
      return <div key={key} dangerouslySetInnerHTML={{ __html: block.raw }} />;
  }
}

// ── Inline renderers ──────────────────────────────────────────────────────────

function renderInlines(inlines: RobinInline[], ctx: RenderCtx): React.ReactNode {
  return inlines.map((inline, i) => renderInline(inline, ctx, i));
}

function renderInline(inline: RobinInline, ctx: RenderCtx, key: number | string): React.ReactNode {
  switch (inline.kind) {
    case 'text': {
      const text = wrapMarks(inline.text, inline.marks ?? []);
      return <React.Fragment key={key}>{text}</React.Fragment>;
    }

    case 'code':
      return <code key={key}>{inline.text}</code>;

    case 'lineBreak':
      return <br key={key} />;

    case 'link':
      return (
        <a key={key} href={inline.href} target="_blank" rel="noopener noreferrer">
          {renderInlines(inline.content, ctx)}
        </a>
      );

    case 'wikilink': {
      const label = inline.alias ?? inline.slug;
      const resolved = ctx.wikimap.resolve(inline.slug);

      if (!resolved) {
        return (
          <a key={key} data-wiki={inline.slug} data-broken="missing" href={`/p/${inline.slug}`}>
            {label}
          </a>
        );
      }

      if (resolved.archived) {
        return (
          <Link key={key} href={vaultPageHref(resolved.path)} data-wiki={inline.slug} data-archived="true">
            {label}
          </Link>
        );
      }

      return (
        <Link key={key} href={vaultPageHref(resolved.path)} data-wiki={inline.slug}>
          {label}
        </Link>
      );
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrapMarks(
  text: string,
  marks: ('bold' | 'italic' | 'strike')[],
): React.ReactNode {
  if (marks.length === 0) return text;

  // Apply marks in canonical order: bold → italic → strike (outermost first)
  const order: Record<'bold' | 'italic' | 'strike', number> = { bold: 0, italic: 1, strike: 2 };
  const sorted = [...marks].sort((a, b) => order[a] - order[b]);

  let node: React.ReactNode = text;
  // Apply in reverse so outer mark wraps correctly
  for (const mark of sorted.slice().reverse()) {
    if (mark === 'bold') node = <strong>{node}</strong>;
    else if (mark === 'italic') node = <em>{node}</em>;
    else if (mark === 'strike') node = <s>{node}</s>;
  }
  return node;
}

function renderItemContent(blocks: RobinBlock[], ctx: RenderCtx): React.ReactNode {
  // Inline-collapse: if the only child is a paragraph, render just its inlines
  if (blocks.length === 1 && blocks[0]?.kind === 'paragraph') {
    return renderInlines(blocks[0].content, ctx);
  }
  // If first is a paragraph, render its inlines, then render the rest as blocks
  if (blocks.length > 0 && blocks[0]?.kind === 'paragraph') {
    return (
      <>
        {renderInlines(blocks[0].content, ctx)}
        {blocks.slice(1).map((b, i) => renderBlock(b, ctx, i))}
      </>
    );
  }
  return <>{blocks.map((b, i) => renderBlock(b, ctx, i))}</>;
}

// ── HubChildren (lazy-loaded) ─────────────────────────────────────────────────

/**
 * Renders a hub-children block. In server components we can't do dynamic
 * fetching easily, so we render a placeholder that shows the query.
 * A future phase can hydrate this with real data from the API.
 */
function HubChildrenBlock({
  query,
}: {
  query: string;
  ctx: RenderCtx;
}) {
  return (
    <ul
      data-block="hubChildren"
      data-query={query}
      className="hub-children-placeholder"
    >
      <li className="text-slate-500 italic text-sm">
        Hub children: {query} (loading requires indexer)
      </li>
    </ul>
  );
}
