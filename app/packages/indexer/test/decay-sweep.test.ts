/**
 * Integration test for runDecaySweep() over an in-memory DB with 4 representative pages.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { openInMemoryDb } from '../src/db.js';
import { indexFile } from '../src/index-file.js';
import { runDecaySweep, ensureDecayColumns } from '../src/decay-sweep.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env['ROBIN_EMBED_MODE'] = 'stub';

const DAY_MS = 1000 * 60 * 60 * 24;
const NOW = Date.now();

function isoAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function makeFixture(
  slug: string,
  type: string,
  updated: string
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${slug}</title>
  <meta name="robin:slug" content="${slug}">
  <meta name="robin:type" content="${type}">
  <meta name="robin:updated" content="${updated}">
  <meta name="robin:summary" content="${slug} summary">
  <script type="application/json" id="robin:frontmatter">{"title":"${slug}","type":"${type}"}</script>
  <script type="application/json" id="robin:blocks">[]</script>
</head>
<body><article data-robin-doc><p>${slug}</p></article></body>
</html>`;
}

interface SweepRow {
  slug: string;
  tier: string | null;
  staleness: number;
  access_count_30d_rolling: number;
}

describe('runDecaySweep()', () => {
  const db = openInMemoryDb();
  const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-sweep-test-'));
  const brainDir = path.join(tmpVault, 'brain');
  fs.mkdirSync(brainDir, { recursive: true });

  // 4 pages of different tiers and ages
  const pages = [
    { slug: 'fresh-task', type: 'task', updatedAgo: 0 },       // working, just updated
    { slug: 'old-task', type: 'task', updatedAgo: 90 },         // working, very stale
    { slug: 'old-meeting', type: 'meeting', updatedAgo: 180 },  // episodic, stale
    { slug: 'template-page', type: 'template', updatedAgo: 500 }, // procedural, never stale
  ];

  beforeAll(async () => {
    ensureDecayColumns(db);

    for (const p of pages) {
      const updated = isoAgo(p.updatedAgo);
      const fp = path.join(brainDir, `${p.slug}.html`);
      fs.writeFileSync(fp, makeFixture(p.slug, p.type, updated));
      await indexFile(db, fp, tmpVault);
    }

    // Run the sweep with a fixed "now"
    runDecaySweep(db, NOW);
  });

  function getRow(slug: string): SweepRow {
    return db
      .prepare('SELECT slug, tier, staleness, access_count_30d_rolling FROM pages WHERE slug = ?')
      .get(slug) as SweepRow;
  }

  it('assigns correct tiers', () => {
    expect(getRow('fresh-task').tier).toBe('working');
    expect(getRow('old-task').tier).toBe('working');
    expect(getRow('old-meeting').tier).toBe('episodic');
    expect(getRow('template-page').tier).toBe('procedural');
  });

  it('procedural page has staleness = 0', () => {
    const row = getRow('template-page');
    expect(row.staleness).toBe(0);
  });

  it('fresh-task has low staleness', () => {
    const row = getRow('fresh-task');
    // staleness = 1 - (0.4 + 0.6 * exp(0)) = 0
    expect(row.staleness).toBeCloseTo(0, 2);
  });

  it('old-task has higher staleness than fresh-task', () => {
    const fresh = getRow('fresh-task');
    const old = getRow('old-task');
    expect(old.staleness).toBeGreaterThan(fresh.staleness);
  });

  it('staleness ordering: fresh-task < old-meeting < old-task < template (0)', () => {
    const freshTask = getRow('fresh-task');
    const oldMeeting = getRow('old-meeting');
    const oldTask = getRow('old-task');
    const template = getRow('template-page');

    // procedural is always 0
    expect(template.staleness).toBe(0);
    // fresh-task is near 0
    expect(freshTask.staleness).toBeLessThan(0.1);
    // old-task (90d working, τ=30) is very stale
    expect(oldTask.staleness).toBeGreaterThan(0.55);
    // old-meeting (180d episodic, τ=90) is also significantly stale
    expect(oldMeeting.staleness).toBeGreaterThan(0.3);
  });

  it('rolling access counter is initialized from 0 and decayed', () => {
    // All pages start at 0 access_count_30d; after sweep they should still be ~0
    for (const p of pages) {
      const row = getRow(p.slug);
      expect(row.access_count_30d_rolling).toBeCloseTo(0, 3);
    }
  });

  it('sweep returns page count', () => {
    const n = runDecaySweep(db, NOW);
    expect(n).toBe(pages.length);
  });

  it('is idempotent — running twice gives same staleness', () => {
    runDecaySweep(db, NOW);
    const r1 = getRow('old-task');
    runDecaySweep(db, NOW);
    const r2 = getRow('old-task');
    expect(r1.staleness).toBeCloseTo(r2.staleness, 5);
  });
});
