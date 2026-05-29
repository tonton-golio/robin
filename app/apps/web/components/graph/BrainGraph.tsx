'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { RefreshCw, ArrowUpRight } from 'lucide-react';

interface GraphNode {
  id: string;
  label: string;
  href: string;
  type: string;
  group: string;
  degree: number;
  summary?: string;
  updated?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  __color?: string;
  __size?: number;
}

function formatUpdated(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = Date.now();
  const diff = now - d.getTime();
  const day = 86400000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}w ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const GROUP_COLOR: Record<string, string> = {
  project: '#e8a13c',
  task: '#d97757',
  decision: '#a78bfa',
  knowledge: '#5ec8ce',
  hub: '#9aa0a8',
  person: '#e8e8e3',
  memory: '#6ba368',
  note: '#5d626b',
  unknown: '#5d626b',
};

const GROUPS = [
  { key: 'all', label: 'All' },
  { key: 'project', label: 'Projects', color: GROUP_COLOR.project },
  { key: 'task', label: 'Tasks', color: GROUP_COLOR.task },
  { key: 'decision', label: 'Decisions', color: GROUP_COLOR.decision },
  { key: 'knowledge', label: 'Knowledge', color: GROUP_COLOR.knowledge },
  { key: 'person', label: 'People', color: GROUP_COLOR.person },
];

function linkId(l: GraphLink): string {
  const s = typeof l.source === 'string' ? l.source : l.source.id;
  const t = typeof l.target === 'string' ? l.target : l.target.id;
  return `${s}→${t}`;
}

function linkEnds(l: GraphLink): [string, string] {
  const s = typeof l.source === 'string' ? l.source : l.source.id;
  const t = typeof l.target === 'string' ? l.target : l.target.id;
  return [s, t];
}

export function BrainGraph() {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [hover, setHover] = useState<{ node: GraphNode; sx: number; sy: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/graph')
      .then((r) => {
        if (!r.ok) throw new Error('failed');
        return r.json();
      })
      .then((d: GraphData) => {
        const decorated: GraphNode[] = d.nodes.map((n) => ({
          ...n,
          __color: GROUP_COLOR[n.group] ?? GROUP_COLOR.note,
          __size: Math.min(14, 3 + Math.sqrt(n.degree) * 1.6),
        }));
        setData({ nodes: decorated, links: d.links });
      })
      .catch(() => setError('Could not load graph.'));
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setSize({ w: width, h: height });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // adjacency from full data (so hover can show neighbors even when filter is active)
  const adjacency = useMemo<Map<string, Set<string>>>(() => {
    const adj = new Map<string, Set<string>>();
    if (!data) return adj;
    for (const l of data.links) {
      const [s, t] = linkEnds(l);
      if (!adj.has(s)) adj.set(s, new Set());
      if (!adj.has(t)) adj.set(t, new Set());
      adj.get(s)!.add(t);
      adj.get(t)!.add(s);
    }
    return adj;
  }, [data]);

  const nodeById = useMemo<Map<string, GraphNode>>(() => {
    const m = new Map<string, GraphNode>();
    if (!data) return m;
    for (const n of data.nodes) m.set(n.id, n);
    return m;
  }, [data]);

  const filtered = useMemo<GraphData | null>(() => {
    if (!data) return null;
    const term = search.trim().toLowerCase();
    if (filter === 'all' && !term) return data;

    let keep = new Set<string>(data.nodes.map((n) => n.id));
    if (filter !== 'all') {
      keep = new Set(data.nodes.filter((n) => n.group === filter).map((n) => n.id));
    }
    if (term) {
      keep = new Set(
        [...keep].filter((id) => {
          const n = nodeById.get(id);
          return n && n.label.toLowerCase().includes(term);
        }),
      );
    }
    const nodes = data.nodes.filter((n) => keep.has(n.id));
    const links = data.links.filter((l) => {
      const [s, t] = linkEnds(l);
      return keep.has(s) && keep.has(t);
    });
    return { nodes, links };
  }, [data, filter, search, nodeById]);

  const hoverInfo = useMemo(() => {
    if (!hover) return null;
    const neighbors = Array.from(adjacency.get(hover.node.id) ?? [])
      .map((id) => nodeById.get(id))
      .filter((n): n is GraphNode => Boolean(n))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 6);
    return neighbors;
  }, [hover, adjacency, nodeById]);

  const highlightedLinks = useMemo<Set<string>>(() => {
    const s = new Set<string>();
    if (!hover || !data) return s;
    for (const l of data.links) {
      const [a, b] = linkEnds(l);
      if (a === hover.node.id || b === hover.node.id) s.add(linkId(l));
    }
    return s;
  }, [hover, data]);

  const onNodeHover = useCallback(
    (n: GraphNode | null) => {
      if (containerRef.current) {
        containerRef.current.style.cursor = n ? 'pointer' : 'default';
      }
      if (!n || !ref.current) {
        setHover(null);
        return;
      }
      const coords = ref.current.graph2ScreenCoords?.(n.x ?? 0, n.y ?? 0);
      if (coords) {
        setHover({ node: n, sx: coords.x, sy: coords.y });
      } else {
        setHover({ node: n, sx: 0, sy: 0 });
      }
    },
    [],
  );

  const refit = useCallback(() => {
    if (ref.current?.zoomToFit) ref.current.zoomToFit(400, 60);
  }, []);

  // Fit once the simulation settles after a data/filter change, not before —
  // fitting mid-layout leaves the cluster off-center as nodes keep spreading.
  const shouldFitRef = useRef(true);
  useEffect(() => {
    shouldFitRef.current = true;
  }, [filtered]);
  const handleEngineStop = useCallback(() => {
    if (!shouldFitRef.current) return;
    shouldFitRef.current = false;
    refit();
  }, [refit]);

  return (
    <div className="graph-page" ref={containerRef}>
      <div className="graph-page-toolbar">
        <div className="graph-pill">
          {filtered
            ? `${filtered.nodes.length} nodes · ${filtered.links.length} edges${
                data && filtered.nodes.length !== data.nodes.length ? ` · of ${data.nodes.length}` : ''
              }`
            : 'loading…'}
        </div>
        <div className="graph-controls">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              className="graph-chip"
              data-active={filter === g.key}
              onClick={() => setFilter(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="graph-controls" style={{ padding: 4 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search nodes…"
            className="graph-search"
          />
          <button type="button" className="graph-chip" onClick={refit} title="Fit to view">
            fit
          </button>
        </div>
      </div>

      <div className="graph-legend">
        {GROUPS.filter((g) => g.key !== 'all').map((g) => (
          <span key={g.key} className="graph-legend-item">
            <span className="graph-legend-dot" style={{ background: g.color }} />
            {g.label}
          </span>
        ))}
      </div>

      {filtered && (() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Graph = ForceGraph2D as unknown as React.ComponentType<any>;
        return (
          <Graph
            ref={ref}
            graphData={filtered}
            width={size.w}
            height={size.h}
            backgroundColor="#0a0b0e"
            nodeRelSize={3}
            nodeColor={(n: GraphNode) => {
              if (!hover) return n.__color ?? GROUP_COLOR.note;
              if (n.id === hover.node.id) return n.__color ?? GROUP_COLOR.note;
              if (adjacency.get(hover.node.id)?.has(n.id)) return n.__color ?? GROUP_COLOR.note;
              return 'rgba(154,160,168,0.18)';
            }}
            nodeVal={(n: GraphNode) => (n.__size ?? 4) ** 2 / 4}
            linkColor={(l: GraphLink) => {
              if (hover && highlightedLinks.has(linkId(l))) return 'rgba(232,161,60,0.65)';
              return 'rgba(94,200,206,0.14)';
            }}
            linkWidth={(l: GraphLink) => (hover && highlightedLinks.has(linkId(l)) ? 1.4 : 0.5)}
            enableNodeDrag
            onEngineStop={handleEngineStop}
            cooldownTicks={140}
            d3AlphaDecay={0.025}
            onNodeClick={(n: GraphNode) => router.push(n.href)}
            onNodeHover={onNodeHover}
            nodeCanvasObjectMode={() => 'after'}
            nodeCanvasObject={(node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
              const dimmed = hover && node.id !== hover.node.id && !adjacency.get(hover.node.id)?.has(node.id);
              if (scale < 1.4 && !(hover && (node.id === hover.node.id || adjacency.get(hover.node.id)?.has(node.id)))) return;
              const fontSize = Math.max(8, 11 / scale);
              ctx.font = `500 ${fontSize}px Geist, Inter, sans-serif`;
              ctx.fillStyle = dimmed ? 'rgba(154,160,168,0.25)' : '#cfd3d8';
              ctx.fillText(node.label, (node.x ?? 0) + (node.__size ?? 5) + 2, (node.y ?? 0) + 3);
            }}
          />
        );
      })()}

      {filtered && filtered.nodes.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-2)', pointerEvents: 'none' }}>
          <span className="graph-pill">No nodes match this filter.</span>
        </div>
      )}

      {!filtered && !error && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-2)' }}>
          <span className="graph-pill"><RefreshCw size={14} strokeWidth={1.5} /> Loading graph…</span>
        </div>
      )}

      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--warning-rust)' }}>
          {error}
        </div>
      )}

      {hover && hoverInfo && (
        <div
          className="graph-hover"
          style={{
            top: Math.min(Math.max(hover.sy + 14, 16), size.h - 220),
            left: Math.min(Math.max(hover.sx + 14, 16), size.w - 280),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: GROUP_COLOR[hover.node.group] ?? GROUP_COLOR.note,
                marginTop: 5,
                flexShrink: 0,
              }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ display: 'block', color: 'var(--text-0)', lineHeight: 1.3 }}>
                {hover.node.label}
              </strong>
              <div className="graph-hover-meta">
                {hover.node.type} · {hover.node.degree} link{hover.node.degree === 1 ? '' : 's'}
                {formatUpdated(hover.node.updated) ? ` · ${formatUpdated(hover.node.updated)}` : ''}
              </div>
            </div>
          </div>
          {hover.node.summary && (
            <p
              style={{
                marginTop: 10,
                fontFamily: 'var(--font-serif)',
                fontSize: 13,
                lineHeight: 1.45,
                color: 'var(--text-1)',
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {hover.node.summary}
            </p>
          )}
          {hoverInfo.length > 0 && (
            <>
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 8,
                  borderTop: '1px solid var(--border-0)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--text-2)',
                }}
              >
                connects to
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: '6px 0 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {hoverInfo.map((n) => (
                  <li
                    key={n.id}
                    style={{
                      fontSize: 12,
                      color: 'var(--text-1)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: GROUP_COLOR[n.group] ?? GROUP_COLOR.note,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.label}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div
            style={{
              marginTop: 10,
              paddingTop: 8,
              borderTop: '1px solid var(--border-0)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-2)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <ArrowUpRight size={11} strokeWidth={1.5} /> click to open
          </div>
        </div>
      )}
    </div>
  );
}
