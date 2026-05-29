/**
 * Regression tests for the wikilinks resolver.
 *
 * The resolver row per slug must be RECOMPUTED from the pages table, not
 * maintained with a sticky `ambiguous` flag. Previously the flag was set on the
 * first collision and never cleared, so a slug stayed ambiguous forever even
 * after the colliding page was deleted/renamed; and deleting one of two pages
 * sharing a slug wiped the survivor's resolver row.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { openInMemoryDb } from '../src/db.js';
import { indexFile, recomputeWikilink } from '../src/index-file.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env['ROBIN_EMBED_MODE'] = 'stub';

function html(slug: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${slug}</title>
  <meta name="robin:slug" content="${slug}">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-05-26T00:00:00Z">
  <script type="application/json" id="robin:frontmatter">{"type":"note"}</script>
  <script type="application/json" id="robin:blocks">[{"kind":"paragraph","content":[{"kind":"text","text":"hi"}]}]</script>
</head>
<body><article data-robin-doc><p>hi</p></article></body>
</html>`;
}

function wikilinkRow(db: ReturnType<typeof openInMemoryDb>, slug: string) {
  return db.prepare('SELECT path, ambiguous FROM wikilinks WHERE slug = ?').get(slug) as
    | { path: string; ambiguous: number }
    | undefined;
}

describe('wikilinks resolver recompute', () => {
  let vault: string;
  let db: ReturnType<typeof openInMemoryDb>;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-wl-'));
    fs.mkdirSync(path.join(vault, 'brain', 'a'), { recursive: true });
    fs.mkdirSync(path.join(vault, 'brain', 'b'), { recursive: true });
    db = openInMemoryDb();
  });

  async function index(rel: string, slug: string) {
    const abs = path.join(vault, rel);
    fs.writeFileSync(abs, html(slug));
    await indexFile(db, abs, vault);
  }

  it('marks a slug ambiguous only while >1 page shares it, and clears on resolution', async () => {
    await index('brain/a/_index.html', '_index');
    expect(wikilinkRow(db, '_index')).toMatchObject({ ambiguous: 0, path: 'brain/a/_index.html' });

    await index('brain/b/_index.html', '_index');
    expect(wikilinkRow(db, '_index')?.ambiguous).toBe(1);

    // Resolve the collision: remove one page and recompute (what the watcher does on unlink).
    db.prepare('DELETE FROM pages WHERE path = ?').run('brain/b/_index.html');
    recomputeWikilink(db, '_index');

    const row = wikilinkRow(db, '_index');
    expect(row?.ambiguous).toBe(0);
    expect(row?.path).toBe('brain/a/_index.html');
  });

  it('keeps the surviving page resolvable after a same-slug sibling is removed', async () => {
    await index('brain/a/_index.html', '_index');
    await index('brain/b/_index.html', '_index');

    db.prepare('DELETE FROM pages WHERE path = ?').run('brain/a/_index.html');
    recomputeWikilink(db, '_index');

    expect(wikilinkRow(db, '_index')).toMatchObject({ ambiguous: 0, path: 'brain/b/_index.html' });
  });

  it('removes the resolver row when the last page with a slug is deleted', async () => {
    await index('brain/a/solo.html', 'solo');
    expect(wikilinkRow(db, 'solo')).toBeTruthy();

    db.prepare('DELETE FROM pages WHERE path = ?').run('brain/a/solo.html');
    recomputeWikilink(db, 'solo');

    expect(wikilinkRow(db, 'solo')).toBeUndefined();
  });
});
