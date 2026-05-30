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
          role="button"
          tabIndex={0}
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

  useEffect(() => {
    fetch('/api/tree')
      .then((r) => r.json())
      .then((d: TreeNode[]) => setTree(d));
  }, []);

  const sections = useMemo(() => {
    if (!tree) return null;
    // Group top-level roots: brain, out, inbox, logs
    return tree;
  }, [tree]);

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
      {!sections && <div style={{ color: 'var(--text-2)', fontSize: 12, padding: 8 }}>Loading…</div>}
      {sections?.map((root) => (
        <div key={root.path}>
          <TreeRow node={root} depth={0} currentPath={path} query={query} />
        </div>
      ))}
    </aside>
  );
}
