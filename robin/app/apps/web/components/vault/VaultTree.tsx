'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Search, FileText, Folder } from 'lucide-react';
import { encodePathSegments, stripHtmlExtension, vaultFileHref, vaultPageHref } from '@/lib/routes';

interface TreeNode {
  name: string;
  path: string;
  kind: 'dir' | 'page' | 'log' | 'file';
  type?: string;
  children?: TreeNode[];
}

function nodeHrefFor(node: TreeNode): string {
  if (node.kind === 'file') return vaultFileHref(node.path);
  return vaultPageHref(node.path);
}

function nodeRoutePrefix(node: TreeNode): string {
  const routePath = encodePathSegments(stripHtmlExtension(node.path));
  return routePath ? `/${routePath}` : '/';
}

function nodeIsActive(node: TreeNode, currentPath: string): boolean {
  if (node.kind !== 'dir') return currentPath === nodeHrefFor(node);

  const prefix = nodeRoutePrefix(node);
  const filePrefix = `/file${prefix === '/' ? '' : prefix}`;
  return (
    currentPath === prefix ||
    currentPath.startsWith(`${prefix}/`) ||
    currentPath === filePrefix ||
    currentPath.startsWith(`${filePrefix}/`)
  );
}

function nodeMatches(node: TreeNode, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  if (node.name.toLowerCase().includes(ql)) return true;
  if (node.path.toLowerCase().includes(ql)) return true;
  if (node.children) return node.children.some((c) => nodeMatches(c, q));
  return false;
}

function TreeRow({
  node,
  depth,
  currentPath,
  query,
}: {
  node: TreeNode;
  depth: number;
  currentPath: string;
  query: string;
}) {
  const isDir = node.kind === 'dir';
  const isActive = nodeIsActive(node, currentPath);
  const [open, setOpen] = useState(depth === 0 || isActive || (query.length > 0 && isDir));

  // Expand everything while filtering; when the filter clears, fall back to the
  // default (top-level + active branch). Keyed only on `query` so this reset
  // does NOT fire on navigation.
  useEffect(() => {
    if (query) setOpen(true);
    else setOpen(depth === 0 || isActive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // On navigation, open the branch containing the current page — but never
  // auto-collapse here, or a directory the user manually expanded would snap
  // shut on the next route change.
  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  if (!nodeMatches(node, query)) return null;

  const indent = depth * 10 + 4;
  if (isDir) {
    return (
      <>
        <div
          className="vault-tree-node"
          style={{ paddingLeft: indent }}
          onClick={() => setOpen((v) => !v)}
          // Make the folder row keyboard-operable: Enter/Space toggle it, and
          // aria-expanded exposes the open/closed state to assistive tech.
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen((v) => !v);
            }
          }}
          role="button"
          tabIndex={0}
          aria-expanded={open}
        >
          <span className="vault-tree-chevron" data-open={open}>
            <ChevronRight size={12} strokeWidth={1.5} />
          </span>
          <Folder size={13} strokeWidth={1.5} style={{ color: 'var(--text-2)' }} />
          <span className="vault-tree-name">{node.name}</span>
        </div>
        {open && node.children?.map((child) => (
          <TreeRow key={child.path} node={child} depth={depth + 1} currentPath={currentPath} query={query} />
        ))}
      </>
    );
  }

  const href = nodeHrefFor(node);
  const active = currentPath === href;

  return (
    <Link
      href={href}
      className="vault-tree-node"
      style={{ paddingLeft: indent + 14 }}
      data-active={active}
    >
      <FileText size={12} strokeWidth={1.5} style={{ color: 'var(--text-2)' }} />
      <span className="vault-tree-name">{node.name.replace(/\.(html|md)$/, '')}</span>
    </Link>
  );
}

export function VaultTree() {
  const path = usePathname() ?? '';
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(false);
  // Bumped to retry after a failed load.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    fetch('/api/tree')
      .then((r) => {
        if (!r.ok) throw new Error(`tree fetch failed: ${r.status}`);
        return r.json();
      })
      .then((d: unknown) => {
        if (cancelled) return;
        // Default to an empty tree on an unexpected shape so the rest of the
        // sidebar stays usable rather than wedging on "Loading…".
        setTree(Array.isArray(d) ? (d as TreeNode[]) : []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const sections = useMemo(() => {
    if (!tree) return null;
    // Group top-level roots: brain, out, inbox, logs
    return tree;
  }, [tree]);

  // True only once the tree has loaded and nothing matches the active filter.
  const hasMatches = useMemo(
    () => !sections || !query || sections.some((root) => nodeMatches(root, query)),
    [sections, query],
  );

  return (
    <aside className="vault-tree">
      <div className="vault-tree-search">
        <Search size={13} strokeWidth={1.5} />
        <input
          type="text"
          placeholder="Filter pages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && (
        <div style={{ color: 'var(--text-2)', fontSize: 12, padding: 8 }}>
          Couldn’t load the vault tree.{' '}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--text-1)',
              font: 'inherit',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}
      {!error && !sections && (
        <div style={{ color: 'var(--text-2)', fontSize: 12, padding: 8 }}>Loading…</div>
      )}
      {!error && sections && !hasMatches && (
        <div style={{ color: 'var(--text-2)', fontSize: 12, padding: 8 }}>
          No pages match “{query}”.
        </div>
      )}
      {!error &&
        sections?.map((root) => (
          <div key={root.path}>
            <TreeRow node={root} depth={0} currentPath={path} query={query} />
          </div>
        ))}
    </aside>
  );
}
