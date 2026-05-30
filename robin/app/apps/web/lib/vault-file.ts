import fs from 'fs/promises';
import path from 'path';
import { locateVault } from './vault';

const ALLOWED_ROOTS = new Set(['brain', 'inbox', 'out', 'logs']);

// Deny-list of vault-relative paths that must never be served over the network,
// even though they live under an allowed root. These mirror the categories the
// vault marks as sensitive/gitignored (raw HR contracts, raw meeting/audio
// recordings). Matching is by normalized POSIX path, so it is independent of
// any particular org's file names. Keep this general — match by location/kind,
// not by individual file titles.
const SENSITIVE_PATH_PREFIXES = [
  'inbox/contracts/', // employment / bonus contracts
];
const SENSITIVE_EXTENSIONS = new Set([
  '.webm', // raw meeting/voice recordings
  '.mp3',
  '.wav',
]);

function isSensitiveVaultPath(normalized: string): boolean {
  if (SENSITIVE_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  if (SENSITIVE_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) return true;
  return false;
}

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

/**
 * Normalize + containment-check a vault-relative path WITHOUT consulting the
 * serve deny-list. Use this for internal READS of vault files (e.g. transcribing
 * a just-uploaded recording) where the network-serve restrictions of
 * normalizeVaultFilePath — which reject raw `.webm/.mp3/.wav` recordings so they
 * are never SERVED to a client — would wrongly block a legitimate read.
 *
 * Still enforces: NUL rejection, `..`/absolute-path rejection, and the
 * ALLOWED_ROOTS allowlist. Returns the normalized POSIX path, or null on reject.
 */
function normalizeContainedVaultPath(input: string | string[]): string | null {
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

export function normalizeVaultFilePath(input: string | string[]): string | null {
  const normalized = normalizeContainedVaultPath(input);
  if (normalized === null) return null;

  // Refuse to serve sensitive vault content (contracts, raw recordings) even
  // when the path is otherwise well-formed and under an allowed root.
  if (isSensitiveVaultPath(normalized)) return null;

  return normalized;
}

/**
 * Read-oriented sibling of normalizeVaultFilePath: same allowlist + traversal +
 * NUL guards, but does NOT apply the serve deny-list, so audio recordings
 * (`.webm/.mp3/.wav`) the app needs to read internally are permitted. Symlink
 * containment is still enforced separately by statVaultFile/resolveContainedVaultPath
 * at read time.
 */
export function normalizeVaultReadPath(input: string | string[]): string | null {
  return normalizeContainedVaultPath(input);
}

export function absoluteVaultFilePath(relPath: string): string {
  return path.join(locateVault(), ...relPath.split('/'));
}

/**
 * Resolve a vault-relative path to its real (symlink-followed) absolute path and
 * verify it is still contained within the real vault root. Throws if the target
 * escapes the vault via a symlink. Callers already wrap stat in try/catch and
 * surface a 404/notFound, so a throw here closes the arbitrary-file-read hole
 * for both the /api/file route and the /file viewer page.
 */
export async function resolveContainedVaultPath(relPath: string): Promise<string> {
  const realRoot = await fs.realpath(locateVault());
  const realTarget = await fs.realpath(absoluteVaultFilePath(relPath));
  // Require the real target to be the root itself or strictly beneath it.
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    throw new Error('vault_path_escape');
  }
  return realTarget;
}

export async function statVaultFile(relPath: string): Promise<{ size: number; mtime: Date; isFile: boolean }> {
  // realpath-based containment check rejects symlinks that point outside the
  // vault before we ever stat/read the underlying file.
  const realTarget = await resolveContainedVaultPath(relPath);
  const stat = await fs.stat(realTarget);
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
