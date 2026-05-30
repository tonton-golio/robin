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

function html(slug: string, linkTarget?: string): string {
  const body = linkTarget
    ? `<p>hi <a data-wiki="${linkTarget}" href="/p/${linkTarget}">x</a></p>`
    : `<p>hi</p>`;
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
<body><article data-robin-doc>${body}</article></body>
</html>`;
}

function wikilinkRow(db: ReturnType<typeof openInMemoryDb>, slug: string) {
  return db.prepare('SELECT path, ambiguous FROM wikilinks WHERE slug = ?').get(slug) as
    | { path: string; ambiguous: number }
    | undefined;
}

function linkCount(db: ReturnType<typeof openInMemoryDb>, fromSlug: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM links WHERE from_slug = ?').get(fromSlug) as {
      n: number;
    }
  ).n;
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

  async function index(rel: string, slug: string, linkTarget?: string) {
    const abs = path.join(vault, rel);
    fs.writeFileSync(abs, html(slug, linkTarget));
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

  it('cleans the old slug when a page is re-indexed in place with a new slug', async () => {
    // Index a page at a stable path with old-slug + one outbound wikilink.
    await index('brain/a/page.html', 'old-slug', 'target-x');
    expect(wikilinkRow(db, 'old-slug')).toMatchObject({ path: 'brain/a/page.html' });
    expect(linkCount(db, 'old-slug')).toBe(1);

    // Re-index the SAME path with a changed robin:slug (an in-place edit, which
    // routes through indexFile as a change event — NOT unlink).
    await index('brain/a/page.html', 'new-slug', 'target-x');

    // New slug resolves and carries the outbound link.
    expect(wikilinkRow(db, 'new-slug')).toMatchObject({ path: 'brain/a/page.html' });
    expect(linkCount(db, 'new-slug')).toBe(1);

    // Old slug is fully orphan-free: no resolver row and no leftover links.
    expect(wikilinkRow(db, 'old-slug')).toBeUndefined();
    expect(linkCount(db, 'old-slug')).toBe(0);
  });

  it('keeps a surviving same-slug sibling resolvable when one page is renamed', async () => {
    // Two pages share slug `dup`. The links table is keyed by from_path, so each
    // page's outbound links are distinct; this test guards that renaming one page
    // does not wipe the SURVIVING sibling's resolver row / links.
    await index('brain/a/dup.html', 'dup', 'target-a');
    await index('brain/b/dup.html', 'dup', 'target-b');
    expect(wikilinkRow(db, 'dup')?.ambiguous).toBe(1);

    // Rename only one of them. A page still carries `dup`, so the old-slug links
    // must NOT be dropped (remaining-count guard) and `dup` must still resolve.
    await index('brain/a/dup.html', 'dup-renamed', 'target-a');

    const dupRow = wikilinkRow(db, 'dup');
    expect(dupRow).toMatchObject({ path: 'brain/b/dup.html', ambiguous: 0 });
    // Links for the still-present `dup` slug were not wiped by the rename guard.
    expect(linkCount(db, 'dup')).toBeGreaterThanOrEqual(1);
    // The renamed page resolves under its new slug.
    expect(wikilinkRow(db, 'dup-renamed')).toMatchObject({ path: 'brain/a/dup.html' });
  });

  it('does not collapse outbound links across pages that share a slug (from_path keying)', async () => {
    // Two distinct `_index` pages (same slug) linking to DIFFERENT targets.
    await index('brain/a/_index.html', '_index', 'target-a');
    await index('brain/b/_index.html', '_index', 'target-b');

    const outOf = (p: string) =>
      (db.prepare('SELECT to_slug FROM links WHERE from_path = ? ORDER BY to_slug').all(p) as Array<{
        to_slug: string;
      }>).map((r) => r.to_slug);

    // Each page's outbound links live under its own path — NOT merged into one
    // shared from_slug='_index' row set (the bug this fix closes).
    expect(outOf('brain/a/_index.html')).toEqual(['target-a']);
    expect(outOf('brain/b/_index.html')).toEqual(['target-b']);

    // A backlink resolves to the EXACT source page (join on from_path), instead
    // of fanning out across every same-slug page.
    const backlinkPaths = (
      db
        .prepare(
          `SELECT DISTINCT p.path FROM links l JOIN pages p ON p.path = l.from_path
            WHERE l.to_slug = ? ORDER BY p.path`,
        )
        .all('target-a') as Array<{ path: string }>
    ).map((r) => r.path);
    expect(backlinkPaths).toEqual(['brain/a/_index.html']);
  });
});
