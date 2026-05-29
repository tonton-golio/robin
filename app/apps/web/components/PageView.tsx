import React from 'react';
import type { RobinBlock, RobinMeta } from '@robin/converter';
import { blocksToReactNodes, type WikiLinkMap } from '@/lib/blocks-to-react';

interface PageViewProps {
  blocks: RobinBlock[];
  meta: RobinMeta;
  wikimap: WikiLinkMap;
}

/**
 * Renders the page content from RobinBlock[] via blocksToReactNodes().
 * Does NOT use dangerouslySetInnerHTML of the body verbatim — blocks JSON
 * is the source of truth per ROBIN_FORMAT.
 */
export function PageView({ blocks, meta, wikimap }: PageViewProps): React.ReactElement {
  const content = blocksToReactNodes(blocks, wikimap);

  return (
    <div className="page-view">
      {/* Page meta bar */}
      <PageMetaBar meta={meta} />

      {/* Content */}
      <article
        data-robin-doc
        data-page-type={meta.type}
        className="robin-prose mt-4"
      >
        {content}
      </article>
    </div>
  );
}

function PageMetaBar({ meta }: { meta: RobinMeta }): React.ReactElement | null {
  const hasMeta =
    meta.state ||
    meta.owner ||
    meta.priority ||
    meta.due ||
    meta.tags.length > 0 ||
    meta.date;

  if (!hasMeta) return null;

  const STATE_COLORS: Record<string, string> = {
    'in-progress': 'bg-blue-500/20 text-blue-300',
    'done': 'bg-green-500/20 text-green-300',
    'stable': 'bg-green-500/20 text-green-300',
    'evolving': 'bg-yellow-500/20 text-yellow-300',
    'needs-review': 'bg-amber-500/20 text-amber-300',
    'archived': 'bg-slate-500/20 text-slate-400',
  };

  const PRIORITY_COLORS: Record<string, string> = {
    p1: 'bg-red-500/20 text-red-300',
    p2: 'bg-orange-500/20 text-orange-300',
    p3: 'bg-yellow-500/20 text-yellow-300',
    p4: 'bg-slate-500/20 text-slate-400',
  };

  return (
    <div className="flex flex-wrap gap-1.5 mb-2 text-xs">
      {meta.type && (
        <span className="px-2 py-0.5 rounded-full bg-[rgba(232,161,60,0.12)] text-[var(--robin-amber)] font-medium">
          {meta.type}
        </span>
      )}
      {meta.state && (
        <span className={`px-2 py-0.5 rounded-full font-medium ${STATE_COLORS[meta.state] ?? 'bg-slate-500/20 text-slate-400'}`}>
          {meta.state}
        </span>
      )}
      {meta.priority && (
        <span className={`px-2 py-0.5 rounded-full font-mono font-bold ${PRIORITY_COLORS[meta.priority] ?? 'bg-slate-500/20'}`}>
          {meta.priority.toUpperCase()}
        </span>
      )}
      {meta.owner && (
        <span className="px-2 py-0.5 rounded-full bg-white/5 text-slate-400">
          {meta.owner}
        </span>
      )}
      {meta.due && (
        <span className="px-2 py-0.5 rounded-full bg-white/5 text-slate-400">
          due {meta.due}
        </span>
      )}
      {meta.date && (
        <span className="px-2 py-0.5 rounded-full bg-white/5 text-slate-400">
          {meta.date}
        </span>
      )}
      {meta.tags.map((tag) => (
        <span key={tag} className="px-2 py-0.5 rounded-full bg-white/5 text-slate-500">
          #{tag}
        </span>
      ))}
    </div>
  );
}
