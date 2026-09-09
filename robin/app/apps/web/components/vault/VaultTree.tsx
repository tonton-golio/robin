'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { vaultFileHref, vaultPageHref } from '@/lib/routes';
import { useActiveDocument } from '@/components/shell/ActiveDocumentProvider';
import { WorkspaceLink } from '@/components/shell/WorkspaceLink';

interface TreeNode {
  name: string;
  path: string;
  kind: 'dir' | 'page' | 'log' | 'file';
  type?: string;
  children?: TreeNode[];
}

/** Row rendered in the flattened, windowed list. */
interface FlatRow {
  node: TreeNode;
  depth: number;
  isDir: boolean;
  hasChildren: boolean;
  open: boolean;
  href: string;
  active: boolean;
}

const WINDOW_CAP = 400;
const TREE_EXPANDED_KEY = 'robin:workspace-tree-expanded';
const TREE_FILTER_KEY = 'robin:workspace-tree-filter';

/** Mono glyph per node kind/type — a legible index, not decoration. */
function glyphFor(node: TreeNode, depth: number): string {
  if (node.kind === 'dir') return depth === 0 ? '▣' : '▤';
  if (node.kind === 'file') return '▪';
  switch (node.type) {
    case 'person':
      return '◍';
    case 'decision':
      return '◆';
    default:
      return '·';
  }
}

function nodeHref(node: TreeNode): string {
  return node.kind === 'file' ? vaultFileHref(node.path) : vaultPageHref(node.path);
}

function countPages(node: TreeNode): number {
  if (node.kind !== 'dir') return node.name.startsWith('_index') ? 0 : 1;
  let n = 0;
  for (const c of node.children ?? []) n += countPages(c);
  return n;
}

function nodeMatches(node: TreeNode, q: string): boolean {
  if (!q) return true;
  if (node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q)) return true;
  return (node.children ?? []).some((c) => nodeMatches(c, q));
}

function displayName(node: TreeNode): string {
  return node.name.replace(/\.(html|md)$/i, '');
}

/**
 * The persistent vault tree — index-fed, keyboard-first, windowed.
 *
 * Flattens the nested vault listing into a single visible-row array (respecting
 * per-folder expansion + the typeahead filter), so j/k navigation and DOM
 * windowing are both trivial: only the rows actually on screen exist in the
 * flat list, and the render caps at {@link WINDOW_CAP} rows so a 311-page vault
 * never paints 311 nodes. Rooted at BRAIN / INBOX / OUT / LOGS.
 */
export function VaultTree({ onNavigate }: { onNavigate?: () => void } = {}) {
  const path = usePathname() ?? '';
  const { requestNavigation } = useActiveDocument();
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [reloadKey, forceReload] = useReducer((k: number) => k + 1, 0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(0);
  const [restored, setRestored] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const storedExpanded = JSON.parse(
        sessionStorage.getItem(TREE_EXPANDED_KEY) ?? '[]',
      ) as unknown;
      if (
        Array.isArray(storedExpanded) &&
        storedExpanded.every((value) => typeof value === 'string')
      ) {
        setExpanded(new Set(storedExpanded));
      }
      setQuery(sessionStorage.getItem(TREE_FILTER_KEY) ?? '');
    } catch {
      // Session storage is progressive enhancement.
    } finally {
      setRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(TREE_EXPANDED_KEY, JSON.stringify([...expanded]));
      sessionStorage.setItem(TREE_FILTER_KEY, query);
    } catch {
      // Ignore unavailable/private-mode storage.
    }
  }, [expanded, query, restored]);

  // Load the listing.
  useEffect(() => {
    let cancelled = false;
    setError(false);
    fetch('/api/tree')
      .then((r) => {
        if (!r.ok) throw new Error(`tree ${r.status}`);
        return r.json();
      })
      .then((d: unknown) => {
        if (cancelled) return;
        setTree(Array.isArray(d) ? (d as TreeNode[]) : []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Expand the roots + the branch containing the current page. Never
  // auto-collapse a folder the reader opened by hand.
  useEffect(() => {
    if (!tree) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      const openAncestors = (nodes: TreeNode[]): boolean => {
        for (const n of nodes) {
          if (n.kind === 'dir') {
            if (openAncestors(n.children ?? [])) {
              next.add(n.path);
              return true;
            }
          } else if (path === nodeHref(n)) {
            return true;
          }
        }
        return false;
      };
      openAncestors(tree);
      return next;
    });
  }, [tree, path]);

  const q = query.trim().toLowerCase();

  // Flatten the tree into the visible-row list.
  const rows = useMemo<FlatRow[]>(() => {
    if (!tree) return [];
    const out: FlatRow[] = [];
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const node of nodes) {
        if (q && !nodeMatches(node, q)) continue;
        const isDir = node.kind === 'dir';
        const kids = node.children ?? [];
        const hasChildren = isDir && kids.length > 0;
        const open = hasChildren && (expanded.has(node.path) || q.length > 0);
        out.push({
          node,
          depth,
          isDir,
          hasChildren,
          open,
          href: nodeHref(node),
          active: !isDir && path === nodeHref(node),
        });
        if (open) walk(kids, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, expanded, q, path]);

  const windowed = rows.slice(0, WINDOW_CAP);
  const total = useMemo(() => (tree ? tree.reduce((a, r) => a + countPages(r), 0) : 0), [tree]);

  useEffect(() => {
    setFocusIdx((i) => Math.min(i, Math.max(0, windowed.length - 1)));
  }, [windowed.length]);

  const toggleDir = useCallback((p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const openRow = useCallback(
    (row: FlatRow) => {
      if (row.isDir) toggleDir(row.node.path);
      else {
        onNavigate?.();
        requestNavigation(row.href);
      }
    },
    [onNavigate, requestNavigation, toggleDir],
  );

  const focusRow = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(windowed.length - 1, index));
      setFocusIdx(next);
      requestAnimationFrame(() => {
        scrollRef.current?.querySelector<HTMLElement>(`[data-row="${next}"]`)?.focus();
      });
    },
    [windowed.length],
  );

  const onScrollKey = useCallback(
    (e: React.KeyboardEvent) => {
      const row = windowed[focusIdx];
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          focusRow(focusIdx + 1);
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          focusRow(focusIdx - 1);
          break;
        case 'Home':
          e.preventDefault();
          focusRow(0);
          break;
        case 'End':
          e.preventDefault();
          focusRow(windowed.length - 1);
          break;
        case 'Enter':
        case 'o':
          if (row) {
            e.preventDefault();
            openRow(row);
          }
          break;
        case ']':
        case 'ArrowRight': {
          if (row?.isDir) {
            e.preventDefault();
            if (!row.open) {
              toggleDir(row.node.path);
            } else {
              const child = windowed[focusIdx + 1];
              if (child && child.depth > row.depth) focusRow(focusIdx + 1);
            }
          }
          break;
        }
        case '[':
        case 'ArrowLeft':
          if (row?.isDir && row.open) {
            e.preventDefault();
            toggleDir(row.node.path);
          } else if (row && row.depth > 0) {
            e.preventDefault();
            let parentIndex = focusIdx - 1;
            while (parentIndex >= 0 && windowed[parentIndex]!.depth >= row.depth) {
              parentIndex -= 1;
            }
            if (parentIndex >= 0) focusRow(parentIndex);
          }
          break;
      }
    },
    [windowed, focusIdx, focusRow, openRow, toggleDir],
  );

  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-row="${focusIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx]);

  return (
    <aside className="r-vault-tree" aria-label="Vault tree">
      <div className="r-vault-tree-head">
        <span className="r-bar">Tree</span>
      </div>
      <div className="r-vault-tree-filter">
        <input
          ref={inputRef}
          type="text"
          spellCheck={false}
          placeholder={total ? `filter ${total} pages…` : 'filter pages…'}
          aria-label="Filter tree"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.currentTarget.blur();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              focusRow(0);
            }
          }}
        />
      </div>

      <div
        className="r-vault-tree-scroll"
        ref={scrollRef}
        role="tree"
        aria-label="Vault pages"
        onKeyDown={onScrollKey}
      >
        {error && (
          <div className="r-vault-tree-msg">
            Couldn&rsquo;t load the vault tree.{' '}
            <button type="button" onClick={forceReload}>
              Retry
            </button>
          </div>
        )}
        {!error && !tree && <div className="r-vault-tree-msg">Loading…</div>}
        {!error && tree && windowed.length === 0 && (
          <div className="r-vault-tree-msg">No pages match &ldquo;{query}&rdquo;.</div>
        )}
        {windowed.map((row, i) => {
          const glyph = glyphFor(row.node, row.depth);
          const count = row.isDir ? countPages(row.node) : 0;
          const props = {
            className: 'r-vault-tnode',
            style: { paddingLeft: 8 + row.depth * 14 },
            'data-row': i,
            'data-active': row.active || undefined,
            'data-focus': i === focusIdx || undefined,
            'data-cur': row.active || undefined,
            role: 'treeitem' as const,
            tabIndex: i === focusIdx ? 0 : -1,
            'aria-level': row.depth + 1,
            'aria-selected': row.active || undefined,
            'aria-expanded': row.isDir ? row.open : undefined,
            onFocus: () => setFocusIdx(i),
            onMouseEnter: () => setFocusIdx(i),
          };
          const inner = (
            <>
              <span className="r-vault-tw" aria-hidden>
                {row.isDir ? (row.open ? '▾' : '▸') : ''}
              </span>
              <span className="r-vault-tglyph" aria-hidden>
                {glyph}
              </span>
              <span className="r-vault-tl">{displayName(row.node)}</span>
              {count > 0 ? <span className="r-vault-tcount">{count}</span> : null}
            </>
          );
          if (row.isDir) {
            return (
              <button key={row.node.path} type="button" {...props} onClick={() => toggleDir(row.node.path)}>
                {inner}
              </button>
            );
          }
          return (
            <WorkspaceLink
              key={row.node.path}
              href={row.href}
              {...props}
              onNavigateStart={onNavigate}
            >
              {inner}
            </WorkspaceLink>
          );
        })}
      </div>

      <div className="r-vault-tree-foot">
        {tree ? `windowed: ${windowed.length} / ${total} · j/k move · enter open · / filter` : '…'}
      </div>
    </aside>
  );
}
