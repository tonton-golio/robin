import React from 'react';
import type { RobinBlock, RobinMeta } from '@robin/converter';
import { blocksToReactNodes, type WikiLinkMap } from '@/lib/blocks-to-react';

interface FlowPageViewProps {
  blocks: RobinBlock[];
  meta: RobinMeta;
  wikimap: WikiLinkMap;
  bodyHtml?: string;
}

/**
 * The document body — the ONE reading model.
 *
 * Renders the page exactly as it sits on disk, in document order: the parsed
 * body HTML when present (the v0.2 source of truth, since blocks live only in
 * memory during conversion), else the in-memory blocks. No section accordion,
 * no per-section framing — navigation is carried by the persistent outline in
 * the reader chrome, so the prose is never collapsed away from the reader.
 *
 * The title + metadata band + provenance are chrome owned by PageWorkspace;
 * this component is only the readable body, and it does not re-emit the H1.
 */
export function FlowPageView({ blocks, meta, wikimap, bodyHtml }: FlowPageViewProps): React.ReactElement {
  if (bodyHtml && bodyHtml.trim()) {
    return (
      <div
        className="robin-prose max-w-none [&>:first-child]:mt-0"
        data-page-type={meta.type}
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />
    );
  }

  if (blocks.length > 0) {
    return (
      <div className="robin-prose max-w-none [&>:first-child]:mt-0" data-page-type={meta.type}>
        {blocksToReactNodes(blocks, wikimap)}
      </div>
    );
  }

  // Honest empty: frontmatter present, no body yet.
  return (
    <div className="r-vault-statebox" data-page-type={meta.type}>
      <div className="st">This page has a frontmatter, but no body yet.</div>
      <p>
        The <span style={{ fontFamily: 'var(--font-mono)' }}>robin:*</span> meta is set, but nothing has been written
        under the headings. An honest empty, not a read failure.
      </p>
      <div className="m">body: 0 blocks</div>
    </div>
  );
}
