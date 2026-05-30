import { redirect } from 'next/navigation';
import { buildSlugMap } from '@/lib/read-page';
import { vaultPageHref } from '@/lib/routes';
import { locateVault } from '@/lib/vault';

interface PageProps {
  params: Promise<{ path: string[] }>;
}

/**
 * Legacy /p/* URLs. Two behaviors:
 *   - Single segment that looks like a bare slug → resolve via slug map, redirect
 *     to the canonical vault-relative URL.
 *   - Anything else → strip the /p/ prefix and redirect.
 *
 * Kept so old bookmarks, wikilinks, and external links keep working.
 */
export default async function LegacyPRoute({ params }: PageProps) {
  const { path: segments } = await params;

  if (segments.length === 1) {
    const slug = segments[0]!;
    const vault = locateVault();
    const slugMap = await buildSlugMap(vault);
    const resolved = slugMap.get(slug);
    if (resolved) {
      redirect(vaultPageHref(resolved));
    }
  }

  redirect(vaultPageHref(segments.join('/')));
}
