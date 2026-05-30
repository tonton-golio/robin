import { NextResponse } from 'next/server';
import { listBrainPages, pageHref } from '@/lib/catalog';
import { locateVault } from '@/lib/vault';
import fs from 'fs/promises';
import path from 'path';

interface GraphNode {
  id: string;
  label: string;
  href: string;
  type: string;
  group: string;
  degree: number;
  summary?: string;
  updated?: string;
}

interface GraphLink {
  source: string;
  target: string;
}

// Maps the real Robin page-type vocabulary (see <meta name="robin:type">) onto
// a smaller set of visual groups used for node color / legend / filters. Keep
// this aligned with the types actually emitted by the vault — unmapped types
// fall through to 'note' (grey) and become an undifferentiated blob.
const TYPE_GROUP: Record<string, string> = {
  // projects & work
  project: 'project',
  repo: 'project',
  feature: 'project',
  // tasks
  task: 'task',
  // decisions
  decision: 'decision',
  // knowledge / reference material
  knowledge: 'knowledge',
  reference: 'knowledge',
  tool: 'knowledge',
  understanding: 'knowledge',
  pattern: 'knowledge',
  playbook: 'knowledge',
  standard: 'knowledge',
  // navigation hubs / indexes
  index: 'hub',
  hub: 'hub',
  // people
  person: 'person',
  about: 'person',
  // operational memory / logs / reflections
  memory: 'memory',
  log: 'memory',
  'work-log': 'memory',
  'reflection-questions': 'memory',
  // loose / unknown
  candidate: 'note',
  note: 'note',
  unknown: 'unknown',
};

interface GraphPayload {
  nodes: GraphNode[];
  links: GraphLink[];
}

function buildGraph(pages: Awaited<ReturnType<typeof listBrainPages>>): GraphPayload {
  const slugIndex = new Map<string, string>();
  for (const p of pages) {
    if (p.slug) slugIndex.set(p.slug, p.path);
    const baseName = path.basename(p.path, '.html');
    if (baseName) slugIndex.set(baseName, p.path);
    if (p.path) slugIndex.set(p.path.replace(/\.html$/, ''), p.path);
  }

  const nodes: GraphNode[] = pages.map((p) => ({
    id: p.path,
    label: p.title,
    href: pageHref(p.path),
    type: p.type ?? 'note',
    group: TYPE_GROUP[p.type ?? 'note'] ?? 'note',
    degree: 0,
    summary: p.summary,
    updated: p.updated,
  }));

  // Build a de-duplicated, undirected adjacency so a reciprocal A→B / B→A pair
  // counts as a single edge. Degree is then neighbors.size, which keeps node
  // sizing and the hover "N links" count consistent with the listed neighbors.
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string): void => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };

  const links: GraphLink[] = [];
  const seenEdges = new Set<string>();
  for (const p of pages) {
    for (const target of p.links ?? []) {
      const targetPath = slugIndex.get(target);
      if (!targetPath || targetPath === p.path) continue;
      // Canonical undirected key so reciprocal links collapse to one edge.
      const key = p.path < targetPath ? `${p.path}\u0000${targetPath}` : `${targetPath}\u0000${p.path}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      links.push({ source: p.path, target: targetPath });
      addEdge(p.path, targetPath);
      addEdge(targetPath, p.path);
    }
  }

  for (const n of nodes) {
    n.degree = adjacency.get(n.id)?.size ?? 0;
  }

  return { nodes, links };
}

/**
 * Cheaply compute a cache fingerprint of brain/ by stat-ing files only (no HTML
 * parse). Returns both the freshest mtime AND the .html file count: a deletion or
 * move-out of a non-newest page leaves `max` unchanged but decrements `count`, so
 * keying on `count:max` invalidates the cache on removals too (the bare-max key
 * went stale, leaving phantom nodes after page_delete/page_move).
 */
async function brainFingerprint(): Promise<{ max: number; count: number }> {
  const root = path.join(locateVault(), 'brain');
  let max = 0;
  let count = 0;
  async function visit(dir: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        try {
          const stat = await fs.stat(full);
          count += 1;
          if (stat.mtimeMs > max) max = stat.mtimeMs;
        } catch {
          /* ignore unreadable file */
        }
      }
    }));
  }
  await visit(root);
  return { max, count };
}

// Module-level cache keyed by the brain fingerprint (file count + freshest
// mtime). The cold build walks + parses every brain page (~10s on a large
// vault); caching turns repeat / post-edit requests into sub-second responses
// while still rebuilding whenever any page changes (mtime advances) OR a page is
// added/removed (count changes). The fingerprint scan only stats files, so the
// hot path avoids re-parsing every page's HTML.
let cache: { key: string; payload: GraphPayload } | null = null;

export async function GET(): Promise<NextResponse> {
  const { max, count } = await brainFingerprint();
  const key = `${count}:${max}`;
  if (cache && cache.key === key) {
    return NextResponse.json(cache.payload);
  }

  const pages = await listBrainPages();
  const payload = buildGraph(pages);
  cache = { key, payload };
  return NextResponse.json(payload);
}
