/**
 * Regression tests for scan()'s ghost-row prune.
 *
 * scan() owns brain/ + out/. indexFile() only upserts, so a full re-scan after a
 * file was deleted out-of-band (manual delete, git checkout, page_delete with no
 * running watcher) must remove the stale pages row — otherwise search, backlinks,
 * the graph and the vault list keep returning pages that 404. The prune must also
 * drop the orphaned vec embedding (keyed by rowid; no trigger cleans it) and clear
 * the slug's links/resolver when no page with that slug remains.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { openInMemoryDb } from '../src/db.js';
import { scan } from '../src/scan.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env['ROBIN_EMBED_MODE'] = 'stub';

function page(slug: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${slug}</title>
  <meta name="robin:slug" content="${slug}">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-05-26T00:00:00Z">
</head>
<body><article data-robin-doc><p>body of ${slug} with content</p></article></body>
</html>`;
}

function pageCount(db: ReturnType<typeof openInMemoryDb>, slug: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM pages WHERE slug = ?').get(slug) as { n: number }).n;
}

function linkCount(db: ReturnType<typeof openInMemoryDb>, fromSlug: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM links WHERE from_slug = ?').get(fromSlug) as { n: number }
  ).n;
}

function wikilinkRow(db: ReturnType<typeof openInMemoryDb>, slug: string) {
  return db.prepare('SELECT path FROM wikilinks WHERE slug = ?').get(slug);
}

describe('scan() — ghost-row prune', () => {
  let vault: string;
  let db: ReturnType<typeof openInMemoryDb>;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-scan-'));
    fs.mkdirSync(path.join(vault, 'brain'), { recursive: true });
    db = openInMemoryDb();
  });

  function write(rel: string, slug: string) {
    fs.writeFileSync(path.join(vault, rel), page(slug));
  }

  it('prunes pages whose file was deleted before a re-scan', async () => {
    write('brain/keep.html', 'keep');
    write('brain/gone.html', 'gone');
    let res = await scan(db, vault, false, 8);
    expect(res.indexed).toBe(2);
    expect(res.pruned).toBe(0);
    expect(pageCount(db, 'gone')).toBe(1);

    // Delete one file out-of-band, then re-scan.
    fs.unlinkSync(path.join(vault, 'brain', 'gone.html'));
    res = await scan(db, vault, false, 8);

    expect(res.pruned).toBe(1);
    expect(pageCount(db, 'gone')).toBe(0);
    expect(pageCount(db, 'keep')).toBe(1);
    // The deleted slug's resolver row is cleared; the survivor's is intact.
    expect(wikilinkRow(db, 'gone')).toBeUndefined();
    expect(wikilinkRow(db, 'keep')).toBeTruthy();
  });

  it('drops the orphaned vec embedding and links for a pruned page', async () => {
    const hasVec = !!db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pages_vec'")
      .get();

    write('brain/solo.html', 'solo');
    await scan(db, vault, false, 8);
    const rowid = (db.prepare('SELECT rowid FROM pages WHERE slug = ?').get('solo') as {
      rowid: number;
    }).rowid;
    if (hasVec) {
      const vecBefore = (
        db.prepare('SELECT COUNT(*) AS n FROM pages_vec WHERE rowid = ?').get(BigInt(rowid)) as {
          n: number;
        }
      ).n;
      expect(vecBefore).toBe(1);
    }

    fs.unlinkSync(path.join(vault, 'brain', 'solo.html'));
    await scan(db, vault, false, 8);

    expect(linkCount(db, 'solo')).toBe(0);
    if (hasVec) {
      const vecAfter = (
        db.prepare('SELECT COUNT(*) AS n FROM pages_vec WHERE rowid = ?').get(BigInt(rowid)) as {
          n: number;
        }
      ).n;
      expect(vecAfter).toBe(0);
    }
  });

  it('does not prune live pages on a clean re-scan', async () => {
    write('brain/a.html', 'a');
    write('brain/b.html', 'b');
    await scan(db, vault, false, 8);
    const res = await scan(db, vault, false, 8);
    expect(res.pruned).toBe(0);
    expect(pageCount(db, 'a')).toBe(1);
    expect(pageCount(db, 'b')).toBe(1);
  });
});
