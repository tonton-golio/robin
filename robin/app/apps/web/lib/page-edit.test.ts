import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convertMarkdown } from '@robin/converter';
import { getPageForEdit, type EditablePage } from './page-edit';

const updated = new Date('2026-05-26T00:00:00Z');

async function writePage(vault: string, rel: string, html: string): Promise<void> {
  const abs = path.join(vault, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, html, 'utf-8');
}

describe('getPageForEdit', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-pe-'));
    process.env['ROBIN_VAULT'] = vault;
  });
  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
    delete process.env['ROBIN_VAULT'];
  });

  it('loads a brain page into blocks and marks it editable', async () => {
    const { html } = convertMarkdown('# Title\n\nHello **world** and [[a-page]].\n', {
      outputPath: 'brain/foo.html',
      updated,
    });
    await writePage(vault, 'brain/foo.html', html);

    const res = (await getPageForEdit('brain/foo.html')) as EditablePage;
    expect('error' in res).toBe(false);
    expect(res.editable).toBe(true);
    expect(res.title).toBe('Title');
    expect(res.frontmatter).toMatchObject({ version: '0.2', type: 'note', title: 'Title' });
    expect(res.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.blocks.some((b) => b.kind === 'heading')).toBe(true);
    expect(res.blocks.some((b) => b.kind === 'paragraph')).toBe(true);
  });

  it('refuses a page carrying raw HTML (non-representable)', async () => {
    const { html } = convertMarkdown('# T\n\nbody\n', { outputPath: 'brain/raw.html', updated });
    // Inject an inline-SVG div into the article body → htmlToBlocks → html{raw}.
    const withRaw = html.replace('</article>', '<div class="chart"><svg viewBox="0 0 4 4"></svg></div></article>');
    await writePage(vault, 'brain/raw.html', withRaw);

    const res = (await getPageForEdit('brain/raw.html')) as EditablePage;
    expect(res.editable).toBe(false);
    expect(res.reason).toMatch(/raw HTML/);
  });

  it('gates non-brain paths', async () => {
    const res = await getPageForEdit('out/deck.html');
    expect('error' in res && res.error).toMatch(/brain/);
  });

  it('reports not_found for a missing brain page', async () => {
    const res = await getPageForEdit('brain/nope.html');
    expect('error' in res && res.error).toBe('not_found');
  });
});
