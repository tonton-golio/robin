import fs from 'fs/promises';
import path from 'path';
import { locateVault } from './vault';

const ALLOWED_ROOTS = new Set(['brain', 'inbox', 'out', 'logs']);
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.html',
  '.json',
  '.jsonl',
  '.log',
  '.md',
  '.tex',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

export function normalizeVaultFilePath(input: string | string[]): string | null {
  const joined = Array.isArray(input) ? input.join('/') : input;
  if (!joined.trim() || joined.includes('\0')) return null;

  const normalized = path.posix.normalize(joined.replaceAll(path.sep, '/')).replace(/^\.\//, '');
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    return null;
  }

  const root = normalized.split('/')[0];
  if (!root || !ALLOWED_ROOTS.has(root)) return null;

  return normalized;
}

export function absoluteVaultFilePath(relPath: string): string {
  return path.join(locateVault(), ...relPath.split('/'));
}

export async function statVaultFile(relPath: string): Promise<{ size: number; mtime: Date; isFile: boolean }> {
  const stat = await fs.stat(absoluteVaultFilePath(relPath));
  return { size: stat.size, mtime: stat.mtime, isFile: stat.isFile() };
}

export function isTextFile(relPath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

export function contentTypeForPath(relPath: string): string {
  switch (path.extname(relPath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.md':
    case '.txt':
    case '.log':
      return 'text/plain; charset=utf-8';
    case '.json':
    case '.jsonl':
      return 'application/json; charset=utf-8';
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webm':
      return 'audio/webm';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    default:
      return 'application/octet-stream';
  }
}
