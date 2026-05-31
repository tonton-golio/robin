import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import {
  contentTypeForPath,
  normalizeVaultFilePath,
  resolveContainedVaultPath,
  statVaultFile,
} from '@/lib/vault-file';

interface FileApiProps {
  params: Promise<{ path: string[] }>;
}

// Vault files are served same-origin and may be authored from ingested
// (untrusted) sources. `script-src 'self'` blocks INLINE scripts — the
// stored-XSS vector (a `<script>…</script>` baked into ingested HTML) — while
// still allowing the app's own same-origin deck runtime (`/robin-deck.js`, the
// ONLY script our generated decks load) to run, so the slide viewer's
// navigation works. `'none'` here silently broke deck navigation
// (window.robinDeck was never defined). object-src/base-uri stay locked down;
// nosniff stops content-type confusion on non-HTML files.
const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "script-src 'self'; object-src 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
};

type ParsedRange = { start: number; end: number } | 'unsatisfiable' | null;

/**
 * Parse a single-range `Range: bytes=` header against a known file size.
 * Returns the inclusive {start,end}, 'unsatisfiable' (→ 416), or null when the
 * header is absent/malformed/multi-range (→ serve the full body, status 200).
 */
function parseRange(header: string | null, size: number): ParsedRange {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null; // multi-range or junk → ignore, serve full

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start: number;
  let end: number;
  if (rawStart === '') {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size || start < 0) {
    return 'unsatisfiable';
  }
  return { start, end };
}

// Node's fs ReadStream is a web ReadableStream once adapted, but the structural
// type differs from the DOM lib's ReadableStream that NextResponse expects.
function toBody(stream: Readable): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream;
}

export async function GET(request: NextRequest, { params }: FileApiProps): Promise<NextResponse> {
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

    // realpath-contained absolute path (rejects symlink escapes); stat above
    // already enforced containment, this resolves the path we actually read.
    const absPath = await resolveContainedVaultPath(relPath);
    const size = stat.size;
    const contentType = contentTypeForPath(relPath);
    const range = parseRange(request.headers.get('range'), size);

    if (range === 'unsatisfiable') {
      return new NextResponse(null, {
        status: 416,
        headers: { ...SECURITY_HEADERS, 'accept-ranges': 'bytes', 'content-range': `bytes */${size}` },
      });
    }

    // Range request (video seeking / progressive playback) → 206 partial body.
    if (range) {
      const { start, end } = range;
      return new NextResponse(toBody(createReadStream(absPath, { start, end })), {
        status: 206,
        headers: {
          ...SECURITY_HEADERS,
          'content-type': contentType,
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes',
        },
      });
    }

    // Full body — streamed (so large videos don't buffer wholly into memory),
    // advertising range support so clients know they can seek.
    return new NextResponse(toBody(createReadStream(absPath)), {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        'content-type': contentType,
        'content-length': String(size),
        'accept-ranges': 'bytes',
      },
    });
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
}
