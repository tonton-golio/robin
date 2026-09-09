import fs from 'fs/promises';
import path from 'path';
import { fromHtml } from 'hast-util-from-html';
import type { Root, Element, Text } from 'hast';
import type { RobinBlock, RobinInline, RobinTaskItem } from '@robin/converter';
import { readPage } from '@/lib/read-page';
import { vaultFileHref, vaultPageHref } from '@/lib/routes';
import { locateVault } from '@/lib/vault';

export interface CatalogPage {
  title: string;
  path: string;
  slug: string;
  type: string;
  summary?: string;
  updated?: string;
  mtime: Date;
  links: string[];
}

export interface OutputItem {
  title: string;
  path: string;
  kind: string;
  href: string;
  mtime: Date;
  size: number;
}

const OUTPUT_ROOTS = ['out'];
const LOG_ROOT = 'logs';
const DAILY_ROOT = 'logs/daily';

export const pageHref = vaultPageHref;
export const fileHref = vaultFileHref;

async function walk(root: string, relDir: string): Promise<string[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(path.join(root, relDir), { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...await walk(root, relPath));
    } else if (entry.isFile()) {
      found.push(relPath);
    }
  }
  return found;
}

function inlineLinks(inlines: RobinInline[], slugs: Set<string>): void {
  for (const inline of inlines) {
    if (inline.kind === 'wikilink') {
      slugs.add(inline.slug);
    } else if ('content' in inline && Array.isArray(inline.content)) {
      inlineLinks(inline.content, slugs);
    }
  }
}

function blockLinks(block: RobinBlock, slugs: Set<string>): void {
  if (!block || typeof block !== 'object') return;
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      if (Array.isArray(block.content)) inlineLinks(block.content, slugs);
      break;
    case 'bulletList':
    case 'numberedList':
      if (Array.isArray(block.items)) {
        for (const item of block.items) {
          if (!item) continue;
          if (Array.isArray(item)) {
            item.forEach((child) => blockLinks(child, slugs));
          } else {
            blockLinks(item as RobinBlock, slugs);
          }
        }
      }
      break;
    case 'taskList':
      if (Array.isArray(block.items)) {
        block.items.forEach((item: RobinTaskItem) => {
          if (!item) return;
          if (Array.isArray(item.content)) inlineLinks(item.content, slugs);
          item.children?.forEach((child) => blockLinks(child, slugs));
        });
      }
      break;
    case 'quote':
    case 'callout':
      if (Array.isArray(block.children)) {
        block.children.forEach((child) => blockLinks(child, slugs));
      }
      break;
    case 'table':
      if (Array.isArray(block.headers)) {
        block.headers.forEach((cell) => Array.isArray(cell) && inlineLinks(cell, slugs));
      }
      if (Array.isArray(block.rows)) {
        block.rows.forEach((row) => {
          if (Array.isArray(row)) row.forEach((cell) => Array.isArray(cell) && inlineLinks(cell, slugs));
        });
      }
      break;
    default:
      break;
  }
}

function linksFromBlocks(blocks: RobinBlock[]): string[] {
  const slugs = new Set<string>();
  blocks.forEach((block) => blockLinks(block, slugs));
  return Array.from(slugs).sort((a, b) => a.localeCompare(b));
}

function titleFromPath(relPath: string): string {
  return path.basename(relPath, path.extname(relPath)).replace(/[-_]+/g, ' ');
}

function outputKind(relPath: string): string {
  const parts = relPath.split('/');
  if (parts.length > 2) return parts[1]!.replace(/[-_]+/g, ' ');
  const ext = path.extname(relPath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'images';
  if (ext === '.html') return 'pages';
  if (['.pdf', '.tex'].includes(ext)) return 'documents';
  if (ext === '.md') return 'notes';
  return ext.replace(/^\./, '') || 'files';
}

function outputHref(relPath: string): string {
  if (relPath.endsWith('.html')) return pageHref(relPath);
  return fileHref(relPath);
}

export async function listLogs(): Promise<OutputItem[]> {
  const vault = locateVault();
  const files = (await walk(vault, LOG_ROOT)).filter((file) => file.endsWith('.md'));
  const items = await Promise.all(files.map(async (file): Promise<OutputItem | null> => {
    try {
      const stat = await fs.stat(path.join(vault, file));
      const name = path.basename(file, '.md');
      const href =
        file === 'logs/ingest-log.md' ? '/_logs/ingest' :
        file === 'logs/repo-log.md' ? '/_logs/repo' :
        '/_logs/changelog';
      return {
        title: titleFromPath(name),
        path: file,
        kind: 'log',
        href,
        mtime: stat.mtime,
        size: stat.size,
      };
    } catch {
      return null;
    }
  }));

  return items
    .filter((item): item is OutputItem => item !== null)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

export interface DailyLogItem {
  date: string; // YYYY-MM-DD
  title: string;
  summary?: string;
  sessions: number; // count of H2 session sections
  outcomes: string[]; // top-level bullet text, for preview
  href: string;
  mtime: Date;
}

function elementText(node: Element | Text | { type: string; children?: unknown[]; value?: string }): string {
  if (node.type === 'text') return (node as Text).value;
  if (node.type === 'element') {
    return ((node as Element).children ?? [])
      .map((c) => elementText(c as Element | Text))
      .join('');
  }
  return '';
}

/** Per-day session-capture pages written by the daily-log hook (logs/daily/*.html). */
export async function listDailyLogs(): Promise<DailyLogItem[]> {
  const vault = locateVault();
  const files = (await walk(vault, DAILY_ROOT)).filter((file) => file.endsWith('.html'));
  const items = await Promise.all(files.map(async (file): Promise<DailyLogItem | null> => {
    const page = await readPage(file);
    if ('error' in page) return null;

    // v0.2 pages have no embedded blocks JSON; walk the article DOM directly to
    // count H2 sessions and collect top-level bullet outcomes.
    let sessions = 0;
    const outcomes: string[] = [];
    if (page.bodyHtml) {
      const tree = fromHtml(page.bodyHtml, { fragment: true }) as Root;
      // bodyHtml is serialized from the article element, so its children are
      // either the article element itself or its body content.
      const article = (tree.children.find(
        (n) => n.type === 'element' && (n as Element).tagName === 'article',
      ) as Element | undefined) ?? null;
      const topLevel = article ? article.children : tree.children;
      for (const child of topLevel) {
        if (child.type !== 'element') continue;
        const el = child as Element;
        if (el.tagName === 'h2') {
          sessions += 1;
        } else if (el.tagName === 'ul') {
          for (const li of el.children) {
            if (li.type !== 'element' || (li as Element).tagName !== 'li') continue;
            const text = elementText(li as Element).replace(/\s+/g, ' ').trim();
            if (text) outcomes.push(text);
          }
        }
      }
    }

    return {
      date: path.basename(file, '.html'),
      title: page.title || titleFromPath(file),
      summary: page.meta.summary,
      sessions,
      outcomes,
      href: pageHref(file),
      mtime: page.mtime,
    };
  }));

  return items
    .filter((item): item is DailyLogItem => item !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function listBrainPages(): Promise<CatalogPage[]> {
  const vault = locateVault();
  const files = (await walk(vault, 'brain')).filter((file) => file.endsWith('.html'));
  const pages = await Promise.all(files.map(async (file): Promise<CatalogPage | null> => {
    const page = await readPage(file);
    if ('error' in page) return null;

    // v0.2 pages have no <script id="robin:blocks"> JSON — wikilinks come from
    // the DOM (page.wikilinkTargets). Fall back to blocks-based extraction for
    // legacy v0.1 pages that still embed the JSON.
    const wikilinks = page.wikilinkTargets.length > 0
      ? Array.from(new Set(page.wikilinkTargets)).sort((a, b) => a.localeCompare(b))
      : linksFromBlocks(page.blocks);

    return {
      title: page.title || titleFromPath(file),
      path: page.filePath,
      slug: page.meta.slug || path.basename(file, '.html'),
      type: page.meta.type || 'note',
      summary: page.meta.summary,
      updated: page.meta.updated,
      mtime: page.mtime,
      links: wikilinks,
    };
  }));

  return pages
    .filter((page): page is CatalogPage => page !== null)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function listOutputs(): Promise<OutputItem[]> {
  const vault = locateVault();
  const files = (await Promise.all(OUTPUT_ROOTS.map((root) => walk(vault, root)))).flat()
    .filter((file) => !file.endsWith('.DS_Store') && !file.endsWith('.gitkeep'))
    // Deck assets (images embedded in decks) are not standalone outputs.
    .filter((file) => !/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(file));

  const items = await Promise.all(files.map(async (file): Promise<OutputItem | null> => {
    try {
      const stat = await fs.stat(path.join(vault, file));
      if (!stat.isFile()) return null;
      const page = file.endsWith('.html') ? await readPage(file) : null;
      const title = page && !('error' in page) && page.title ? page.title : titleFromPath(file);
      return {
        title,
        path: file,
        kind: outputKind(file),
        href: outputHref(file),
        mtime: stat.mtime,
        size: stat.size,
      };
    } catch {
      return null;
    }
  }));

  return items
    .filter((item): item is OutputItem => item !== null)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}
