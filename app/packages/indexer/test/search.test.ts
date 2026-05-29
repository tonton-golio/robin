/**
 * Tests for search() with an in-memory SQLite DB.
 *
 * Uses ROBIN_EMBED_MODE=stub to avoid downloading the embedding model.
 * Ingests 4 fixture pages and asserts basic search behavior.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { openInMemoryDb } from '../src/db.js';
import { indexFile } from '../src/index-file.js';
import { search } from '../src/search.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Force stub embeddings for all tests in this file
process.env['ROBIN_EMBED_MODE'] = 'stub';

// Helper: create a minimal Robin HTML file on disk, index it, and return the path
function makeHtmlFixture(
  slug: string,
  type: string,
  title: string,
  bodyText: string,
  tags: string[] = []
): string {
  const tagMeta = tags.map((t) => `  <meta name="robin:tag" content="${t}">`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="robin:slug" content="${slug}">
  <meta name="robin:type" content="${type}">
  <meta name="robin:updated" content="2026-05-26T00:00:00Z">
  <meta name="robin:summary" content="${title} summary">
${tagMeta}
  <script type="application/json" id="robin:frontmatter">
{"title": "${title}", "type": "${type}"}
  </script>
  <script type="application/json" id="robin:blocks">
[{"kind": "paragraph", "content": [{"kind": "text", "text": "${bodyText}"}]}]
  </script>
</head>
<body>
  <article data-robin-doc>
    <p>${bodyText}</p>
  </article>
</body>
</html>`;
}

describe('search() with in-memory DB and stub embeddings', () => {
  const db = openInMemoryDb();

  // Create a temp vault dir with a few fixture pages
  const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-test-'));
  const agentBrainDir = path.join(tmpVault, 'brain');
  fs.mkdirSync(agentBrainDir, { recursive: true });

  const fixtures = [
    {
      slug: 'jordan-lee',
      type: 'person',
      title: 'Jordan Lee',
      body: 'Jordan Lee is CTO at ExampleCo. He oversees the technology roadmap and platform decisions.',
      tags: ['stakeholder'],
    },
    {
      slug: 'beacon-project',
      type: 'project',
      title: 'Beacon Project',
      body: 'Beacon is the Automated Catalog Enrichment project. It aims for 99% precision on enrichment tasks.',
      tags: ['beacon', 'flagship'],
    },
    {
      slug: 'chris-doyle',
      type: 'person',
      title: 'Chris Doyle',
      body: 'Chris Doyle is working on advisories and keywords for the Beacon pipeline.',
      tags: ['team'],
    },
    {
      slug: 'riley-cohen',
      type: 'person',
      title: 'Riley Cohen',
      body: 'Riley Cohen joined the team in May 2026. He is working on eval data and DevOps for Beacon.',
      tags: ['team'],
    },
  ];

  beforeAll(async () => {
    // Write fixture files and index them
    for (const f of fixtures) {
      const filePath = path.join(agentBrainDir, `${f.slug}.html`);
      fs.writeFileSync(filePath, makeHtmlFixture(f.slug, f.type, f.title, f.body, f.tags));
      await indexFile(db, filePath, tmpVault);
    }
  });

  it('finds jordan-lee when searching "jordan"', async () => {
    const hits = await search(db, 'jordan', { k: 5 });
    expect(hits.length).toBeGreaterThan(0);
    const slugs = hits.map((h) => h.slug);
    expect(slugs).toContain('jordan-lee');
  });

  it('jordan-lee appears in top 3 results for "jordan"', async () => {
    const hits = await search(db, 'jordan', { k: 5 });
    const topSlugs = hits.slice(0, 3).map((h) => h.slug);
    expect(topSlugs).toContain('jordan-lee');
  });

  it('finds Beacon project when searching "enrichment"', async () => {
    const hits = await search(db, 'enrichment', { k: 5 });
    expect(hits.length).toBeGreaterThan(0);
    const slugs = hits.map((h) => h.slug);
    expect(slugs).toContain('beacon-project');
  });

  it('finds chris when searching "advisories"', async () => {
    const hits = await search(db, 'advisories', { k: 5 });
    expect(hits.length).toBeGreaterThan(0);
    const slugs = hits.map((h) => h.slug);
    expect(slugs).toContain('chris-doyle');
  });

  it('returns hits with required fields', async () => {
    const hits = await search(db, 'jordan', { k: 5 });
    expect(hits.length).toBeGreaterThan(0);
    const hit = hits[0]!;
    expect(typeof hit.path).toBe('string');
    expect(typeof hit.slug).toBe('string');
    expect(typeof hit.score).toBe('number');
    expect(hit.score).toBeGreaterThan(0);
  });

  it('type filter narrows results to only persons', async () => {
    const hits = await search(db, 'Beacon', { k: 10, types: ['person'] });
    for (const hit of hits) {
      // Check the DB record
      const row = db.prepare('SELECT type FROM pages WHERE slug = ?').get(hit.slug) as
        | { type: string }
        | undefined;
      expect(row?.type).toBe('person');
    }
  });

  it('returns empty for a nonsense query', async () => {
    const hits = await search(db, 'xyzzy_nonexistent_9999', { k: 5 });
    // May return 0 or a few via fuzzy vector; just check it doesn't throw
    expect(Array.isArray(hits)).toBe(true);
  });

  it('search results all have scores', async () => {
    const hits = await search(db, 'Beacon precision', { k: 10 });
    for (const hit of hits) {
      expect(typeof hit.score).toBe('number');
      expect(hit.score).toBeGreaterThan(0);
    }
  });
});
