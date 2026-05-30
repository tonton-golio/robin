import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { marked } from 'marked';
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

  const html = await marked(stripFrontmatter(raw), {
    gfm: true,
    breaks: false,
  });

  const title = file === 'changelog' ? 'Changelog' : file === 'ingest' ? 'Ingest Log' : 'Repo Log';

  return NextResponse.json({ html, raw, title, file });
}
