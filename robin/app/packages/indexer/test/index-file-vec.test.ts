/**
 * Regression tests for indexFile()'s pages_vec (embedding) bookkeeping.
 *
 * The vector arm is keyed by pages.rowid and is NOT cleaned by the FTS triggers,
 * so it must be maintained explicitly. Two defects covered here:
 *   - Emptying a page's body must DROP its embedding (previously the refresh was
 *     gated on `&& bodyText`, so an emptied body left the stale vector behind,
 *     making vector search match content the page no longer has).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { openInMemoryDb } from '../src/db.js';
import { indexFile } from '../src/index-file.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env['ROBIN_EMBED_MODE'] = 'stub';

function page(slug: string, bodyInner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${slug}</title>
  <meta name="robin:slug" content="${slug}">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-05-26T00:00:00Z">
</head>
<body><article data-robin-doc>${bodyInner}</article></body>
</html>`;
}

function hasVecTable(db: ReturnType<typeof openInMemoryDb>): boolean {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pages_vec'")
    .get();
}

function vecCount(db: ReturnType<typeof openInMemoryDb>, rowid: number): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM pages_vec WHERE rowid = ?').get(BigInt(rowid)) as {
      n: number;
    }
  ).n;
}

function rowidOf(db: ReturnType<typeof openInMemoryDb>, relPath: string): number {
  return (db.prepare('SELECT rowid FROM pages WHERE path = ?').get(relPath) as { rowid: number })
    .rowid;
}

describe('indexFile() — embedding lifecycle', () => {
  let vault: string;
  let db: ReturnType<typeof openInMemoryDb>;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-vec-'));
    fs.mkdirSync(path.join(vault, 'brain'), { recursive: true });
    db = openInMemoryDb();
  });

  async function index(rel: string, bodyInner: string, slug = 'p') {
    const abs = path.join(vault, rel);
    fs.writeFileSync(abs, page(slug, bodyInner));
    await indexFile(db, abs, vault);
  }

  it('drops the stale embedding when a page body is emptied', async () => {
    if (!hasVecTable(db)) return; // vec extension unavailable — nothing to assert

    await index('brain/p.html', '<p>some real content here</p>');
    const rowid = rowidOf(db, 'brain/p.html');
    expect(vecCount(db, rowid)).toBe(1);

    // Re-index the same path with an empty/whitespace-only body. The body hash
    // changes (bodyText becomes ''), so the refresh must DELETE the old vector.
    await index('brain/p.html', '<p>   </p>');
    expect(rowidOf(db, 'brain/p.html')).toBe(rowid); // rowid stable (upsert by path)
    expect(vecCount(db, rowid)).toBe(0);
  });

  it('keeps an embedding for a non-empty edit', async () => {
    if (!hasVecTable(db)) return;

    await index('brain/p.html', '<p>first body</p>');
    const rowid = rowidOf(db, 'brain/p.html');
    await index('brain/p.html', '<p>second body, different</p>');
    expect(vecCount(db, rowid)).toBe(1);
  });
});
