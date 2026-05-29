import React from 'react';
import path from 'path';
import fs from 'fs/promises';
import { marked, Renderer } from 'marked';
import { locateVault } from '@/lib/vault';

const LOG_MAP: Record<string, { file: string; title: string }> = {
  changelog: { file: 'logs/changelog.md', title: 'Changelog' },
  ingest: { file: 'logs/ingest-log.md', title: 'Ingest Log' },
  repo: { file: 'logs/repo-log.md', title: 'Repo Log' },
};

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

interface LogViewProps {
  file: string;
}

export async function LogView({ file }: LogViewProps): Promise<React.ReactElement> {
  const logMeta = LOG_MAP[file];

  if (!logMeta) {
    return (
      <div className="px-8 py-6">
        <h1 className="text-xl font-bold text-red-400">Unknown log: {file}</h1>
        <p className="text-slate-400 mt-2">
          Available logs: {Object.keys(LOG_MAP).join(', ')}
        </p>
      </div>
    );
  }

  const vault = locateVault();
  const absPath = path.join(vault, logMeta.file);

  let raw: string;
  try {
    raw = await fs.readFile(absPath, 'utf-8');
  } catch {
    return (
      <div className="px-8 py-6">
        <h1 className="text-xl font-bold text-slate-200 mb-2">{logMeta.title}</h1>
        <p className="text-slate-500">
          Log file not found: <code className="text-[var(--robin-amber)]">{logMeta.file}</code>
        </p>
      </div>
    );
  }

  // Escape raw inline/block HTML in the source so fragments like
  // `<a data-wiki="slug">` or `<meta ...>` that appear in changelog prose
  // render as literal text instead of being parsed into the DOM. Unescaped
  // raw HTML (e.g. a bare unclosed <a>) reshapes the parsed tree and breaks
  // hydration of the sibling shell widgets.
  const escapeHtmlToken = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtmlToken(text);

  const html = await marked(stripFrontmatter(raw), { gfm: true, breaks: false, renderer });

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-xl font-bold text-slate-100">{logMeta.title}</h1>
          <span className="text-xs px-2 py-0.5 rounded bg-white/5 text-slate-500 font-mono">
            {logMeta.file}
          </span>
        </div>

        <div
          className="robin-log robin-prose"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
