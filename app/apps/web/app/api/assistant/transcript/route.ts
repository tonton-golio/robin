import { NextRequest, NextResponse } from 'next/server';
import { convertMarkdown } from '@robin/converter';
import { vaultPageHref } from '@/lib/routes';
import { writePage, notifyIndexerWrite } from '@/lib/write-page';
import { OWNER_NAME } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USER_SPEAKER = OWNER_NAME || 'User';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function escapeYamlString(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function transcriptMarkdown(turns: Turn[], title: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const frontmatter = [
    '---',
    'type: assistant-session',
    `date: ${date}`,
    `title: "${escapeYamlString(title)}"`,
    `speakers: [${USER_SPEAKER}, Assistant]`,
    'tags: [assistant]',
    `updated: ${now.toISOString()}`,
    '---',
  ].join('\n');

  const body = turns
    .map((turn) => {
      const speaker = turn.role === 'user' ? USER_SPEAKER : 'Assistant';
      return `**${speaker}:**\n\n${turn.text.trim()}`;
    })
    .join('\n\n');

  return `${frontmatter}\n\n# ${title}\n\n${body}\n`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { turns?: unknown; title?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.turns)) {
    return NextResponse.json({ error: '`turns` must be an array' }, { status: 400 });
  }

  const turns: Turn[] = body.turns
    .map((turn): Turn | null => {
      if (!turn || typeof turn !== 'object') return null;
      const candidate = turn as { role?: unknown; text?: unknown };
      if ((candidate.role !== 'user' && candidate.role !== 'assistant') || typeof candidate.text !== 'string') {
        return null;
      }
      const text = candidate.text.trim();
      return text ? { role: candidate.role, text } : null;
    })
    .filter((turn): turn is Turn => turn !== null);

  if (!turns.length) {
    return NextResponse.json({ error: 'No transcript turns to save' }, { status: 400 });
  }

  const title = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim()
    : 'Assistant Session';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
  const outputPath = `out/assistant/${stamp}-${slugify(title) || 'assistant-session'}.html`;
  const markdown = transcriptMarkdown(turns, title);
  const converted = convertMarkdown(markdown, { outputPath, title });

  await writePage({ vaultRelativePath: outputPath, html: converted.html });
  void notifyIndexerWrite(outputPath);

  return NextResponse.json({
    ok: true,
    path: outputPath,
    slug: converted.meta.slug,
    url: vaultPageHref(outputPath),
  });
}
