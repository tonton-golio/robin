import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { marked, Renderer } from 'marked';
import { locateVault } from '@/lib/vault';

const LOG_MAP: Record<string, string> = {
  changelog: 'logs/changelog.md',
  ingest: 'logs/ingest-log.md',
  repo: 'logs/repo-log.md',
};

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

/**
 * GET /api/log?file=changelog|ingest|repo
 * Returns { html: string, raw: string, title: string }
 * — the markdown file rendered to HTML via marked().
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get('file');

  if (!file || !LOG_MAP[file]) {
    return NextResponse.json(
      { error: `Unknown log file. Valid values: ${Object.keys(LOG_MAP).join(', ')}` },
      { status: 400 },
    );
  }

  const vault = locateVault();
  const absPath = path.join(vault, LOG_MAP[file]!);

  let raw: string;
  try {
    raw = await fs.readFile(absPath, 'utf-8');
  } catch {
    return NextResponse.json({ error: 'not_found', file }, { status: 404 });
  }

  // Escape any raw inline/block HTML in the markdown source so embedded
  // <script>/<img onerror>/<iframe> (or `[x](javascript:...)`) render as
  // literal text instead of executing. This mirrors the escaping the in-app
  // LogView RSC applies, so the two markdown renderers can't diverge into a
  // stored-XSS gap if a client ever consumes this endpoint's `html`.
  const escapeHtmlToken = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtmlToken(text);
  // Neutralize dangerous link protocols (javascript:/data:/vbscript:) emitted by
  // markdown `[text](javascript:...)`. The link text is still rendered; only the
  // href is dropped so the anchor can't execute script.
  const DANGEROUS_PROTOCOL = /^[\s\x00-\x1f]*(?:javascript|data|vbscript):/i;
  const baseLink = renderer.link.bind(renderer);
  renderer.link = (token) => {
    if (DANGEROUS_PROTOCOL.test(token.href)) {
      // Render the visible link text but drop the unsafe href entirely.
      return renderer.parser.parseInline(token.tokens);
    }
    return baseLink(token);
  };

  const html = await marked(stripFrontmatter(raw), {
    gfm: true,
    breaks: false,
    renderer,
  });

  const title = file === 'changelog' ? 'Changelog' : file === 'ingest' ? 'Ingest Log' : 'Repo Log';

  return NextResponse.json({ html, raw, title, file });
}
