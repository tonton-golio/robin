'use client';

import React from 'react';
import type { UIHit } from './lib';

/**
 * Render `text` with every matched term wrapped in the blue `.r-hl` block —
 * "what Robin found for you". In degraded (grep-fallback) mode the results
 * container carries `.is-degraded`, and page-search.css collapses these marks
 * to a plain mono underline, so the blue never claims a ranking the fallback
 * cannot back up.
 */
function Highlight({ text, terms }: { text: string; terms: string[] }): React.ReactElement {
  if (!text) return <>{text}</>;
  if (terms.length === 0) return <>{text}</>;
  const escaped = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="r-hl">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

export interface ResultRowProps {
  hit: UIHit;
  selected: boolean;
  degraded: boolean;
  onSelect: () => void;
  onOpenHere: () => void;
  onOpenTree: () => void;
  onOpenNewTab: () => void;
  onCopy: () => void;
  registerRef: (el: HTMLLIElement | null) => void;
}

/** Verbs vary by corpus, matching the spec's action strip. */
function verbs(corpus: UIHit['corpus']): { open: string; tree: string; copy: string } {
  if (corpus === 'memory') return { open: 'Open in memory', tree: 'Trace lineage', copy: 'Copy id' };
  return { open: 'Open', tree: 'Open in vault tree', copy: 'Copy path' };
}

export function ResultRow({
  hit,
  selected,
  degraded,
  onSelect,
  onOpenHere,
  onOpenTree,
  onOpenNewTab,
  onCopy,
  registerRef,
}: ResultRowProps): React.ReactElement {
  const v = verbs(hit.corpus);
  const overdue = hit.statusKind === 'overdue';
  return (
    <li
      ref={registerRef}
      className="srch-row"
      tabIndex={0}
      data-corpus={hit.corpus}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect()}
      onFocus={() => onSelect()}
    >
      <span className="srch-glyph" title={hit.type ?? hit.corpus} aria-hidden>
        {hit.glyph}
      </span>

      <div className="srch-body">
        <div className="srch-title">
          <Highlight text={hit.title} terms={hit.matched} />
        </div>
        <div className="srch-path r-mono">{hit.path}</div>
        {hit.snippet && (
          <p className="srch-snippet">
            <Highlight text={hit.snippet} terms={hit.matched} />
          </p>
        )}
        <div className="r-prov srch-prov">
          {hit.provActor ? (
            <>
              <span>{hit.provOrigin}</span>
              <span className="r-actor" data-who={hit.provActor}>
                {hit.provActor}
              </span>
              {hit.provDetail && <span>· {hit.provDetail}</span>}
            </>
          ) : (
            <span>{hit.provOrigin}</span>
          )}
        </div>

        <div className="srch-actions">
          <button type="button" className="srch-act" onClick={(e) => { e.stopPropagation(); onOpenHere(); }}>
            {v.open}
            <span className="k">↵</span>
          </button>
          <button type="button" className="srch-act" onClick={(e) => { e.stopPropagation(); onOpenNewTab(); }}>
            New tab
            <span className="k">⌘↵</span>
          </button>
          <button type="button" className="srch-act" onClick={(e) => { e.stopPropagation(); onOpenTree(); }}>
            {v.tree}
            <span className="k">o</span>
          </button>
          <button type="button" className="srch-act" onClick={(e) => { e.stopPropagation(); onCopy(); }}>
            {v.copy}
            <span className="k">y</span>
          </button>
        </div>
      </div>

      <div className="srch-side">
        {hit.statusLabel && (
          <span className={`r-pill is-${hit.statusKind ?? 'waiting'}`}>{hit.statusLabel}</span>
        )}
        {overdue && <span className="srch-due">overdue</span>}
        {/* Relevance score: small, deliberate, honest — dropped in degraded mode by CSS. */}
        {!degraded && <span className="srch-score r-mono">{hit.score.toFixed(2)}</span>}
      </div>
    </li>
  );
}
