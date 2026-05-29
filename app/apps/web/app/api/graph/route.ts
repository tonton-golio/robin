import { NextResponse } from 'next/server';
import { listBrainPages, pageHref } from '@/lib/catalog';
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

const TYPE_GROUP: Record<string, string> = {
  project: 'project',
  task: 'task',
  decision: 'decision',
  understanding: 'knowledge',
  pattern: 'knowledge',
  playbook: 'knowledge',
  standard: 'knowledge',
  hub: 'hub',
  person: 'person',
  about: 'person',
  memory: 'memory',
  log: 'memory',
  note: 'note',
  unknown: 'unknown',
};

export async function GET(): Promise<NextResponse> {
  const pages = await listBrainPages();

  const slugIndex = new Map<string, string>();
  for (const p of pages) {
    if (p.slug) slugIndex.set(p.slug, p.path);
    const baseName = path.basename(p.path, '.html');
    if (baseName) slugIndex.set(baseName, p.path);
    if (p.path) slugIndex.set(p.path.replace(/\.html$/, ''), p.path);
  }

  const linkCount = new Map<string, number>();
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

  const links: GraphLink[] = [];
  for (const p of pages) {
    for (const target of p.links ?? []) {
      const targetPath = slugIndex.get(target);
      if (!targetPath || targetPath === p.path) continue;
      links.push({ source: p.path, target: targetPath });
      linkCount.set(p.path, (linkCount.get(p.path) ?? 0) + 1);
      linkCount.set(targetPath, (linkCount.get(targetPath) ?? 0) + 1);
    }
  }

  for (const n of nodes) {
    n.degree = linkCount.get(n.id) ?? 0;
  }

  return NextResponse.json({ nodes, links });
}
