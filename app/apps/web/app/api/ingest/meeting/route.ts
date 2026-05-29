/**
 * GET|POST /api/ingest/meeting?path=<vault-relative-path>
 *
 * Local Robin ingest for meeting transcripts saved by
 * /api/meeting/save-transcript. Reads a vault-relative inbox meeting markdown
 * file, emits a canonical meeting HTML page, and records the ingest event.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { vaultPageHref } from '@/lib/routes';
import { locateVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MeetingFrontmatter = {
  title?: string;
  date?: string;
  attendees?: string[];
  duration?: string;
  summary?: string;
};

const MEETING_SOURCE_PREFIXES = [
  `inbox${path.sep}meetings${path.sep}`,
];

function jsonResponse(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

async function getRequestPath(request: NextRequest): Promise<string | null> {
  const { searchParams } = new URL(request.url);
  const queryPath = searchParams.get('path');
  if (queryPath) {
    return queryPath;
  }

  if (request.method !== 'POST') {
    return null;
  }

  try {
    const body = await request.json() as { path?: unknown };
    return typeof body.path === 'string' ? body.path : null;
  } catch {
    return null;
  }
}

function safeMeetingSourcePath(sourcePath: string): string | null {
  if (!sourcePath.trim() || path.isAbsolute(sourcePath) || sourcePath.includes('\0')) {
    return null;
  }

  const normalized = path.normalize(sourcePath).replace(/^\.\/+/, '');
  if (
    normalized === '..' ||
    normalized.startsWith(`..${path.sep}`) ||
    !MEETING_SOURCE_PREFIXES.some(prefix => normalized.startsWith(prefix)) ||
    path.extname(normalized) !== '.md'
  ) {
    return null;
  }

  return normalized;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

function parseFrontmatter(markdown: string): { frontmatter: MeetingFrontmatter; body: string } {
  if (!markdown.startsWith('---\n')) {
    return { frontmatter: {}, body: markdown.trim() };
  }

  const end = markdown.indexOf('\n---', 4);
  if (end === -1) {
    return { frontmatter: {}, body: markdown.trim() };
  }

  const frontmatterRaw = markdown.slice(4, end).trim();
  const body = markdown.slice(end + 4).trim();
  const frontmatter: MeetingFrontmatter = {};

  for (const line of frontmatterRaw.split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = stripWrappingQuotes(line.slice(separator + 1).trim());

    if (key === 'title') {
      frontmatter.title = value;
    } else if (key === 'date') {
      frontmatter.date = value;
    } else if (key === 'duration') {
      frontmatter.duration = value;
    } else if (key === 'summary') {
      frontmatter.summary = value;
    } else if (key === 'attendees') {
      frontmatter.attendees = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(attendee => stripWrappingQuotes(attendee.trim()))
        .filter(Boolean);
    }
  }

  return { frontmatter, body };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ── Markdown-lite body → RobinBlock[] ──────────────────────────────────────
// The saved meeting body is mostly a transcript, but the AI review step can
// prepend "## Summary", "## Key points" (bullets) and "## Action items"
// (task list) sections. We parse those into real blocks so the brain page
// renders proper headings / lists rather than literal markdown.

type Inline =
  | { kind: 'text'; text: string; marks?: string[] }
  | { kind: 'lineBreak' };

type Block =
  | { kind: 'heading'; level: number; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'bulletList'; items: Block[][] }
  | { kind: 'taskList'; items: Array<{ checked: boolean; content: Inline[] }> };

function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    out.push({ kind: 'text', text: m[1]!, marks: ['bold'] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out.length ? out : [{ kind: 'text', text }];
}

function paragraphInlines(chunk: string): Inline[] {
  const inlines: Inline[] = [];
  chunk.split('\n').forEach((line, i) => {
    if (i > 0) inlines.push({ kind: 'lineBreak' });
    inlines.push(...parseInline(line));
  });
  return inlines;
}

function classifyChunk(chunk: string): Block {
  const trimmed = chunk.trim();
  const lines = trimmed.split('\n');

  const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
  if (lines.length === 1 && heading) {
    return { kind: 'heading', level: Math.min(6, heading[1]!.length), content: parseInline(heading[2]!) };
  }

  if (lines.every(l => /^- \[[ xX]\]\s+/.test(l.trim()))) {
    return {
      kind: 'taskList',
      items: lines.map(l => {
        const m = /^- \[([ xX])\]\s+(.*)$/.exec(l.trim())!;
        return { checked: m[1]!.toLowerCase() === 'x', content: parseInline(m[2]!) };
      }),
    };
  }

  if (lines.every(l => /^[-*]\s+/.test(l.trim()))) {
    return {
      kind: 'bulletList',
      items: lines.map(l => {
        const m = /^[-*]\s+(.*)$/.exec(l.trim())!;
        return [{ kind: 'paragraph', content: parseInline(m[1]!) } as Block];
      }),
    };
  }

  return { kind: 'paragraph', content: paragraphInlines(trimmed) };
}

function parseBodyToBlocks(body: string): Block[] {
  return body
    .split(/\n{2,}/)
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(classifyChunk);
}

function renderInlineHtml(inlines: Inline[]): string {
  return inlines
    .map(inline => {
      if (inline.kind === 'lineBreak') return '<br>';
      const text = escapeHtml(inline.text);
      return inline.marks?.includes('bold') ? `<strong>${text}</strong>` : text;
    })
    .join('');
}

function renderBlockHtml(block: Block): string {
  switch (block.kind) {
    case 'heading':
      return `    <h${block.level} data-block="heading">${renderInlineHtml(block.content)}</h${block.level}>`;
    case 'paragraph':
      return `    <p data-block="paragraph">${renderInlineHtml(block.content)}</p>`;
    case 'bulletList':
      return [
        '    <ul data-block="bulletList">',
        ...block.items.map(item => {
          const inner = item
            .map(b => (b.kind === 'paragraph' ? renderInlineHtml(b.content) : ''))
            .join('');
          return `      <li data-block="listItem">${inner}</li>`;
        }),
        '    </ul>',
      ].join('\n');
    case 'taskList':
      return [
        '    <ul data-block="taskList">',
        ...block.items.map(
          item => `      <li data-block="task" data-checked="${item.checked}">${renderInlineHtml(item.content)}</li>`,
        ),
        '    </ul>',
      ].join('\n');
  }
}

function buildMeetingHtml(input: {
  sourcePath: string;
  outputPath: string;
  slug: string;
  title: string;
  date: string;
  attendees: string[];
  duration?: string;
  transcript: string;
  summary?: string;
  updated: string;
}): string {
  const summary =
    input.summary && input.summary.trim()
      ? input.summary.trim()
      : `Transcript ingested from ${input.sourcePath}.`;
  const metaLine = [
    input.attendees.length ? `Attendees: ${input.attendees.join(', ')}` : null,
    input.duration ? `Duration: ${input.duration}` : null,
    `Source: ${input.sourcePath}`,
  ]
    .filter(Boolean)
    .join('. ');

  // Parse the saved body (transcript, optionally with AI Summary / Key points /
  // Action items sections). If the body carries no headings of its own, wrap it
  // under a "Transcript" heading for backward compatibility with plain saves.
  const bodyBlocks = parseBodyToBlocks(input.transcript);
  const hasHeading = bodyBlocks.some(b => b.kind === 'heading');
  const contentBlocks: Block[] = hasHeading
    ? bodyBlocks
    : [{ kind: 'heading', level: 2, content: [{ kind: 'text', text: 'Transcript' }] }, ...bodyBlocks];

  // v0.2: blocks are an in-memory intermediate. We render the <article> body
  // directly and do not embed the full block tree as a JSON payload anymore.

  const attendeeMeta = input.attendees
    .map(attendee => `  <meta name="robin:attendee" content="${escapeHtml(attendee)}">`)
    .join('\n');
  const durationMeta = input.duration
    ? `  <meta name="robin:duration" content="${escapeHtml(input.duration)}">\n`
    : '';
  const bodyHtml = contentBlocks.map(renderBlockHtml).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(input.title)}</title>
  <link rel="canonical" href="${vaultPageHref(input.outputPath)}">
  <meta name="robin:version" content="0.2">
${attendeeMeta ? `${attendeeMeta}\n` : ''}  <meta name="robin:date" content="${escapeHtml(input.date)}">
${durationMeta}  <meta name="robin:path" content="${escapeHtml(input.outputPath)}">
  <meta name="robin:slug" content="${escapeHtml(input.slug)}">
  <meta name="robin:source" content="${escapeHtml(input.sourcePath)}">
  <meta name="robin:state" content="stable">
  <meta name="robin:summary" content="${escapeHtml(summary)}">
  <meta name="robin:type" content="meeting">
  <meta name="robin:updated" content="${escapeHtml(input.updated)}">
</head>
<body>
  <article data-robin-doc>
    <h1 data-block="heading">${escapeHtml(input.title)}</h1>
    <p data-block="paragraph">${escapeHtml(metaLine)}</p>
${bodyHtml}
  </article>
</body>
</html>
`;
}

async function prependOrReplaceIngestLog(input: {
  vault: string;
  sourcePath: string;
  outputPath: string;
  slug: string;
  attendees: string[];
  updated: string;
}): Promise<void> {
  const logPath = path.join(/*turbopackIgnore: true*/ input.vault, 'logs', 'ingest-log.md');
  const current = await fs.readFile(logPath, 'utf-8').catch(() => '# Ingest Log\n');
  const entry = [
    `## ${input.updated} — meeting — ${input.slug}`,
    '',
    `- **source**: \`${input.sourcePath}\``,
    `- **output**: \`${input.outputPath}\``,
    input.attendees.length ? `- **attendees**: ${input.attendees.join(', ')}` : null,
    '- **status**: ingested locally',
    '',
  ]
    .filter(line => line !== null)
    .join('\n');

  const escapedSource = input.sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existingEntry = new RegExp(
    `\\n?## [^\\n]+ — meeting — [^\\n]+\\n\\n- \\*\\*source\\*\\*: \`${escapedSource}\`[\\s\\S]*?(?=\\n## |$)`,
  );
  const withoutExisting = current.replace(existingEntry, '').trimEnd();
  const heading = '# Ingest Log';
  const headingIndex = withoutExisting.indexOf(heading);
  const next =
    headingIndex >= 0
      ? `${withoutExisting.slice(0, headingIndex + heading.length)}\n\n${entry}${withoutExisting
          .slice(headingIndex + heading.length)
          .trimStart()}`
      : `${withoutExisting ? `${withoutExisting}\n\n` : ''}${heading}\n\n${entry}`;
  const tmp = `${logPath}.tmp-${process.pid}-${Date.now()}`;

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(tmp, next, 'utf-8');
  await fs.rename(tmp, logPath);
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const requestedPath = await getRequestPath(request);
  if (!requestedPath) {
    return jsonResponse({ error: 'missing_path', message: 'Provide a vault-relative inbox meeting markdown path.' }, 400);
  }

  const sourcePath = safeMeetingSourcePath(requestedPath);
  if (!sourcePath) {
    return jsonResponse(
      {
        error: 'unsafe_path',
        message: 'Path must be a vault-relative inbox/meetings/*.md file.',
        path: requestedPath,
      },
      400,
    );
  }

  const vault = locateVault();
  const sourceAbs = path.join(/*turbopackIgnore: true*/ vault, sourcePath);
  const resolvedVault = path.resolve(/*turbopackIgnore: true*/ vault);
  const resolvedSource = path.resolve(/*turbopackIgnore: true*/ sourceAbs);
  if (!resolvedSource.startsWith(`${resolvedVault}${path.sep}`)) {
    return jsonResponse({ error: 'unsafe_path', path: requestedPath }, 400);
  }

  let rawMarkdown: string;
  try {
    rawMarkdown = await fs.readFile(resolvedSource, 'utf-8');
  } catch {
    return jsonResponse({ error: 'not_found', path: sourcePath }, 404);
  }

  const { frontmatter, body } = parseFrontmatter(rawMarkdown);
  if (!body.trim()) {
    return jsonResponse({ error: 'empty_transcript', path: sourcePath }, 400);
  }

  const updated = new Date().toISOString();
  const date = frontmatter.date ?? updated.slice(0, 10);
  const sourceBase = path.basename(sourcePath, '.md');
  const slug = slugify(sourceBase) || `meeting-${date}`;
  const title = frontmatter.title && frontmatter.title !== slug
    ? frontmatter.title
    : `${slug} — ${date}`;
  const outputPath = path.join('logs', 'meetings', `${slug}.html`);
  const outputAbs = path.join(/*turbopackIgnore: true*/ vault, outputPath);
  const attendees = frontmatter.attendees ?? [];

  const html = buildMeetingHtml({
    sourcePath,
    outputPath,
    slug,
    title,
    date,
    attendees,
    duration: frontmatter.duration,
    transcript: body,
    summary: frontmatter.summary,
    updated,
  });

  await fs.mkdir(path.dirname(outputAbs), { recursive: true });
  await fs.writeFile(outputAbs, html, 'utf-8');
  await prependOrReplaceIngestLog({
    vault,
    sourcePath,
    outputPath,
    slug,
    attendees,
    updated,
  });

  return jsonResponse({
    ok: true,
    sourcePath,
    outputPath,
    logPath: 'logs/ingest-log.md',
    pageUrl: vaultPageHref(outputPath),
  });
}

export { handler as GET, handler as POST };
