import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { locateVault } from '@/lib/vault';

export interface TreeNode {
  name: string;
  path: string;
  kind: 'dir' | 'page' | 'log' | 'file';
  type?: string;
  mtime?: string;
  children?: TreeNode[];
}

/**
 * GET /api/tree
 * Returns a JSON tree of brain/, inbox/, out/, and logs/.
 */
export async function GET(): Promise<NextResponse> {
  const vault = locateVault();
  const roots: TreeNode[] = [];

  const brainNode = await buildTree(
    path.join(vault, 'brain'),
    'brain',
  );
  if (brainNode) roots.push(brainNode);

  const inboxNode = await buildTree(
    path.join(vault, 'inbox'),
    'inbox',
  );
  if (inboxNode) roots.push(inboxNode);

  const artifactsNode = await buildTree(
    path.join(vault, 'out'),
    'out',
  );
  if (artifactsNode) roots.push(artifactsNode);

  const logsNode = await buildTree(
    path.join(vault, 'logs'),
    'logs',
  );
  if (logsNode) roots.push(logsNode);

  return NextResponse.json(roots);
}

async function buildTree(
  absDir: string,
  relDir: string,
): Promise<TreeNode | null> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const children: TreeNode[] = [];

  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.') && e.name !== '.gitkeep');

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  for (const dir of dirs) {
    const childRel = `${relDir}/${dir.name}`;
    const childAbs = path.join(absDir, dir.name);
    const child = await buildTree(childAbs, childRel);
    if (child) children.push(child);
  }

  for (const file of files) {
    const relPath = `${relDir}/${file.name}`;
    const isHtml = file.name.endsWith('.html');
    const isKnownLog =
      relPath === 'logs/changelog.md' ||
      relPath === 'logs/ingest-log.md' ||
      relPath === 'logs/repo-log.md';

    // The tree sidebar consumes only name/path/kind/children, so we deliberately
    // avoid stat()-ing and head-reading every file here — doing so cost hundreds
    // of syscalls per request and scaled linearly with vault size. If type/mtime
    // are needed again, source them from the index in one query rather than
    // re-reading files on every tree fetch.
    const nodeKind: TreeNode['kind'] = isKnownLog ? 'log' : isHtml ? 'page' : 'file';
    const nodePath = isKnownLog
      ? relPath === 'logs/ingest-log.md'
        ? '_logs/ingest'
        : relPath === 'logs/repo-log.md'
          ? '_logs/repo'
          : '_logs/changelog'
      : relPath;

    children.push({
      name: file.name.replace(/\.(html|md)$/, ''),
      path: nodePath,
      kind: nodeKind,
    });
  }

  const dirName = path.basename(relDir);
  return {
    name: dirName,
    path: relDir,
    kind: 'dir',
    children,
  };
}
