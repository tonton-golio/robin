import path from 'path';

// No-env fallback only. Real runs always set ROBIN_VAULT (via .env.local /
// .mcp.json / Makefile); set it to your vault's absolute path.
const DEFAULT_VAULT = path.join(process.cwd(), 'base');

/** Locate the vault root. Respects ROBIN_VAULT, then falls back to this repo. */
export function locateVault(): string {
  return process.env['ROBIN_VAULT'] ?? DEFAULT_VAULT;
}

/**
 * Resolve a vault-relative path to an absolute path.
 */
export function vaultPath(...segments: string[]): string {
  return path.join(locateVault(), ...segments);
}

/**
 * Convert a vault-absolute path to vault-relative.
 */
export function toRelative(absPath: string): string {
  const vault = locateVault();
  return absPath.startsWith(vault)
    ? absPath.slice(vault.length).replace(/^\//, '')
    : absPath;
}

/**
 * Convert a URL path parameter (array of segments from /p/[...path])
 * to the vault-relative .html file path.
 * Example: ['brain', '_index'] → 'brain/_index.html'
 */
export function routeParamsToFilePath(segments: string[]): string {
  return segments.join('/') + '.html';
}
