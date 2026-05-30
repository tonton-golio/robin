import React from 'react';
import type { RobinBlock, RobinMeta } from '@robin/converter';
import { blocksToReactNodes, type WikiLinkMap } from '@/lib/blocks-to-react';
import { blockInlineText } from '@/lib/page-graph';
import { Pill } from '@/components/ui';
import { cn } from '@/lib/utils';

interface FlowPageViewProps {
  blocks: RobinBlock[];
  meta: RobinMeta;
  wikimap: WikiLinkMap;
  bodyHtml?: string;
}

interface FlowSection {
  id: string;
  title: string;
  blocks: RobinBlock[];
  level: number;
}

function sectionize(blocks: RobinBlock[]): FlowSection[] {
  const sections: FlowSection[] = [];
  let current: FlowSection | null = null;

  for (const block of blocks) {
    if (block.kind === 'heading' && block.level <= 3) {
      current = {
        id: `section-${sections.length}`,
        title: blockInlineText(block) || `Section ${sections.length + 1}`,
        blocks: [block],
        level: block.level,
      };
      sections.push(current);
      continue;
    }

    if (!current) {
      current = {
        id: 'section-0',
        title: 'Overview',
        blocks: [],
        level: 2,
      };
      sections.push(current);
    }
    current.blocks.push(block);
  }

  return sections;
}

function formatMetaDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function sectionLabel(section: FlowSection, index: number): string {
  if (index === 0 && section.level === 1) return 'Root';
  if (section.level === 2) return 'Branch';
  if (section.level === 3) return 'Detail';
  return 'Node';
}

function PageMetaBar({ meta }: { meta: RobinMeta }): React.ReactElement | null {
  const chips = [
    meta.type,
    meta.state,
    meta.priority?.toUpperCase(),
    meta.owner,
    meta.due ? `due ${formatMetaDate(meta.due)}` : null,
    meta.date ? formatMetaDate(meta.date) : null,
    ...meta.tags.map((tag) => `#${tag}`),
  ].filter(Boolean);

  if (chips.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {chips.map((chip, i) => (
        // Key by index, not chip text: facet values can collide (owner == type/
        // state, or duplicate tags) producing duplicate-string keys, which warns
        // and can mis-reconcile chips. The array order is static within a render.
        <Pill key={`${i}-${chip}`} tone="neutral">
          {chip}
        </Pill>
      ))}
    </div>
  );
}

export function FlowPageView({ blocks, meta, wikimap, bodyHtml }: FlowPageViewProps): React.ReactElement {
  const sections = sectionize(blocks);

  if (sections.length === 0) {
    // v0.2 fallback: blocks live only in-memory during conversion, so pages
    // read from disk have empty blocks. Render the parsed body HTML directly.
    if (bodyHtml && bodyHtml.trim()) {
      return (
        <article data-robin-doc data-page-type={meta.type} className="relative">
          <PageMetaBar meta={meta} />
          <div
            className="robin-prose max-w-none [&>:first-child]:mt-0"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        </article>
      );
    }
    return (
      <article data-robin-doc data-page-type={meta.type} className="relative">
        <PageMetaBar meta={meta} />
        <p className="text-sm text-muted-foreground italic">This page has no content yet.</p>
      </article>
    );
  }

  // A single un-sectioned blob renders inline without the flow container —
  // the branch/detail framing only earns its pixels when there are multiple sections.
  if (sections.length === 1 && sections[0]?.level === 2 && sections[0]?.title === 'Overview') {
    return (
      <article data-robin-doc data-page-type={meta.type} className="relative">
        <PageMetaBar meta={meta} />
        <div className="robin-prose max-w-none [&>:first-child]:mt-0">
          {blocksToReactNodes(sections[0].blocks, wikimap)}
        </div>
      </article>
    );
  }

  return (
    <article data-robin-doc data-page-type={meta.type} className="relative">
      <PageMetaBar meta={meta} />
      <div
        className="relative grid gap-[18px] pl-6 before:absolute before:bottom-7 before:left-[9px] before:top-7 before:w-0.5 before:bg-[linear-gradient(180deg,rgba(94,200,206,0.68),rgba(94,200,206,0.54),rgba(251,191,36,0.22))] sm:before:block max-sm:pl-0 max-sm:before:hidden"
        aria-label="Page flow"
      >
        {sections.map((section, index) => (
          <details
            key={section.id}
            className={cn(
              'group relative rounded-xl border border-border bg-card shadow-[0_20px_50px_rgba(0,0,0,0.2)]',
              'open:border-ring/40 open:bg-card',
            )}
            open={index < 2}
            data-level={section.level}
          >
            <summary
              className={cn(
                'grid cursor-pointer list-none items-center gap-[13px] p-4 [&::-webkit-details-marker]:hidden',
                'grid-cols-[auto_minmax(0,1fr)_auto] max-sm:grid-cols-[minmax(0,1fr)]',
              )}
            >
              <span
                aria-hidden="true"
                className="h-[13px] w-[13px] rounded-full border-2 border-[var(--robin-amber)] bg-background shadow-[0_0_0_5px_var(--background)] max-sm:hidden"
              />
              <span className="grid min-w-0 gap-[3px]">
                <span className="font-mono text-[11px] font-bold uppercase leading-none text-muted-foreground">
                  {sectionLabel(section, index)} {index + 1}
                </span>
                <span
                  className="overflow-hidden text-ellipsis text-[17px] font-bold leading-tight text-foreground max-sm:whitespace-normal sm:whitespace-nowrap"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  {section.title}
                </span>
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground max-sm:hidden">
                {section.blocks.length} blocks
              </span>
            </summary>
            <div className="robin-prose max-w-none border-t border-border px-[clamp(16px,3vw,28px)] pb-5 pt-[18px] [&>:first-child]:mt-0">
              {blocksToReactNodes(section.blocks, wikimap)}
            </div>
          </details>
        ))}
      </div>
    </article>
  );
}
