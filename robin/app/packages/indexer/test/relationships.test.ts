import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openInMemoryDb } from '../src/db.js';
import { indexFile } from '../src/index-file.js';
import { getPageConnections } from '../src/relationships.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env['ROBIN_EMBED_MODE'] = 'stub';

type TestDb = ReturnType<typeof openInMemoryDb>;

interface Fixture {
  slug: string;
  title: string;
  bodyHtml: string;
  type?: string;
}

function html(fixture: Fixture): string {
  const bodyText = fixture.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const type = fixture.type ?? 'note';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${fixture.title}</title>
  <meta name="robin:slug" content="${fixture.slug}">
  <meta name="robin:type" content="${type}">
  <meta name="robin:updated" content="2026-05-26T00:00:00Z">
  <script type="application/json" id="robin:frontmatter">${JSON.stringify({
    title: fixture.title,
    type,
  })}</script>
  <script type="application/json" id="robin:blocks">${JSON.stringify([
    { kind: 'paragraph', content: [{ kind: 'text', text: bodyText }] },
  ])}</script>
</head>
<body><article data-robin-doc>${fixture.bodyHtml}</article></body>
</html>`;
}

describe('getPageConnections()', () => {
  let db: TestDb;
  let vault: string;

  beforeEach(async () => {
    process.env['ROBIN_EMBED_MODE'] = 'stub';
    db = openInMemoryDb();
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-relationships-'));

    await index('brain/alpha.html', {
      slug: 'alpha-page',
      title: 'Alpha Page',
      bodyHtml: `<p>
        Alpha links to <a data-wiki="beta-hub" href="/p/beta-hub">Beta Hub</a>
        and <a data-wiki="delta-project" href="/p/delta-project">Delta Project</a>.
        Gamma Draft should be linked from here. Archive Plan is historical.
        Home is a generic page title.
      </p>`,
    });
    await index('brain/beta.html', {
      slug: 'beta-hub',
      title: 'Beta Hub',
      bodyHtml: `<p>
        Beta links to <a data-wiki="gamma-draft" href="/p/gamma-draft">Gamma Draft</a>
        and <a data-wiki="delta-project" href="/p/delta-project">Delta Project</a>.
      </p>`,
    });
    await index('brain/gamma.html', {
      slug: 'gamma-draft',
      title: 'Gamma Draft',
      bodyHtml: '<p>Gamma detail.</p>',
    });
    await index('brain/delta.html', {
      slug: 'delta-project',
      title: 'Delta Project',
      bodyHtml: '<p>Delta detail.</p>',
    });
    await index('brain/source.html', {
      slug: 'source-note',
      title: 'Source Note',
      bodyHtml: '<p>Source links to <a data-wiki="alpha-page" href="/p/alpha-page">Alpha Page</a>.</p>',
    });
    await index('brain/archive/archive-plan.html', {
      slug: 'archive-plan',
      title: 'Archive Plan',
      bodyHtml: '<p>Archived plan.</p>',
    });
    await index('brain/home.html', {
      slug: 'home',
      title: 'Home',
      bodyHtml: '<p>Generic home page.</p>',
    });
    await index('brain/path-literal.html', {
      slug: 'brain/alpha.html',
      title: 'Literal Slug',
      bodyHtml: '<p>This slug intentionally collides with another page path.</p>',
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  async function index(relPath: string, fixture: Fixture): Promise<void> {
    const filePath = path.join(vault, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, html(fixture));
    await indexFile(db, filePath, vault);
  }

  it('returns outbound wikilinks and backlinks for the current page', () => {
    const connections = getPageConnections(db, 'brain/alpha.html');

    expect(connections?.page).toMatchObject({
      path: 'brain/alpha.html',
      slug: 'alpha-page',
      title: 'Alpha Page',
    });
    expect(connections?.outbound.map((link) => link.page.slug)).toEqual([
      'beta-hub',
      'delta-project',
    ]);
    expect(connections?.backlinks.map((link) => link.page.slug)).toEqual(['source-note']);
  });

  it('returns deterministic two-hop trails and excludes direct duplicate targets', () => {
    const connections = getPageConnections(db, 'brain/alpha.html', { trailLimit: 5 });

    expect(connections?.trails).toHaveLength(1);
    expect(connections?.trails[0]).toMatchObject({
      via: { slug: 'beta-hub', path: 'brain/beta.html' },
      target: { slug: 'gamma-draft', path: 'brain/gamma.html' },
      reason: 'Two-hop path through Beta Hub',
    });
  });

  it('suggests unlinked mentions and skips already-linked, generic, and archived pages', () => {
    const connections = getPageConnections(db, 'brain/alpha.html', { suggestionLimit: 10 });
    const suggestionSlugs = connections?.suggestions.map((suggestion) => suggestion.page.slug) ?? [];

    expect(suggestionSlugs).toContain('gamma-draft');
    expect(connections?.suggestions.find((suggestion) => suggestion.page.slug === 'gamma-draft')).toMatchObject({
      matchedText: 'Gamma Draft',
      reason: 'Title mentioned without a wikilink',
      score: 0.95,
    });
    expect(suggestionSlugs).not.toContain('beta-hub');
    expect(suggestionSlugs).not.toContain('delta-project');
    expect(suggestionSlugs).not.toContain('archive-plan');
    expect(suggestionSlugs).not.toContain('home');
  });

  it('falls back to resolving by slug when exact path is absent', () => {
    const byExactPath = getPageConnections(db, 'brain/alpha.html');
    const bySlug = getPageConnections(db, 'alpha-page');
    const missing = getPageConnections(db, 'does-not-exist');

    expect(byExactPath?.page.slug).toBe('alpha-page');
    expect(bySlug?.page.path).toBe('brain/alpha.html');
    expect(missing).toBeNull();
  });
});
