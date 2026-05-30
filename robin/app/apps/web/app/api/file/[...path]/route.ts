import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import {
  absoluteVaultFilePath,
  contentTypeForPath,
  normalizeVaultFilePath,
  statVaultFile,
} from '@/lib/vault-file';

interface FileApiProps {
  params: Promise<{ path: string[] }>;
}

export async function GET(_request: NextRequest, { params }: FileApiProps): Promise<NextResponse> {
  const { path } = await params;
  const relPath = normalizeVaultFilePath(path);
  if (!relPath) {
    return NextResponse.json({ error: 'unsafe_path' }, { status: 400 });
  }

  try {
    const stat = await statVaultFile(relPath);
    if (!stat.isFile) {
      return NextResponse.json({ error: 'not_file' }, { status: 404 });
    }

    const body = await fs.readFile(absoluteVaultFilePath(relPath));
    return new NextResponse(body, {
      headers: {
        'content-type': contentTypeForPath(relPath),
        'content-length': String(stat.size),
        // Vault HTML is served same-origin and can be authored from ingested
        // (untrusted) sources. `script-src 'self'` blocks INLINE scripts — the
        // stored-XSS vector (a `<script>…</script>` baked into ingested HTML) —
        // while still allowing the app's own same-origin deck runtime
        // (`/robin-deck.js`, the ONLY script our generated decks load) to run, so
        // the slide viewer's next/prev/keyboard navigation works. `'none'` here
        // silently broke deck navigation (window.robinDeck was never defined).
        // object-src/base-uri stay locked down; nosniff stops content-type
        // confusion on non-HTML files.
        'content-security-policy': "script-src 'self'; object-src 'none'; base-uri 'none'",
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
}
