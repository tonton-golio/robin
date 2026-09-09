/** Browser-safe identity. Next inlines the public owner setting at build time. */
export const OWNER_NAME = (process.env.NEXT_PUBLIC_ROBIN_OWNER ?? '').trim();
export const OWNER_KEY = OWNER_NAME.toLowerCase();
export const OWNER_LABEL = OWNER_NAME || 'You';

/** Match a configured name as a complete name, never as part of another word. */
export function matchesName(value: string, name: string): boolean {
  if (!name.trim()) return false;
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(value);
}

export function isOwner(value: string): boolean {
  return ['owner', 'human', 'you'].includes(value.trim().toLowerCase()) || matchesName(value, OWNER_NAME);
}
