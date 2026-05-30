import { describe, it, expect } from 'vitest';
import { migrateV01ToV02 } from '../src/migrations/v0.1-to-v0.2.js';

const V01_FIXTURE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test Page</title>
  <link rel="canonical" href="/p/test-page">
  <meta name="robin:version" content="0.1">
  <meta name="robin:slug" content="test-page">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-05-26T00:00:00Z">
  <meta name="robin:tag" content="alpha">
  <meta name="robin:tag" content="beta">
  <script type="application/json" id="robin:frontmatter">{
  "title": "Test Page",
  "type": "note"
}</script>
  <script type="application/json" id="robin:blocks">[
  {"kind": "heading", "level": 1, "content": [{"kind": "text", "text": "Test Page"}]},
  {"kind": "paragraph", "content": [{"kind": "text", "text": "Hello [[other-page|world]]."}]}
]</script>
</head>
<body>
  <article data-robin-doc>
    <h1>Test Page</h1>
    <p>Hello <a data-wiki="other-page" href="/p/other-page">world</a>.</p>
  </article>
</body>
</html>`;

const V02_EXPECTED = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test Page</title>
  <link rel="canonical" href="/p/test-page">
  <meta name="robin:version" content="0.2">
  <meta name="robin:slug" content="test-page">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-05-26T00:00:00Z">
  <meta name="robin:tag" content="alpha">
  <meta name="robin:tag" content="beta">
</head>
<body>
  <article data-robin-doc>
    <h1>Test Page</h1>
    <p>Hello <a data-wiki="other-page" href="/p/other-page">world</a>.</p>
  </article>
</body>
</html>`;

describe('migrateV01ToV02', () => {
  it('strips both robin:frontmatter and robin:blocks script tags', () => {
    const { html, changed } = migrateV01ToV02(V01_FIXTURE);
    expect(changed).toBe(true);
    expect(html).not.toContain('id="robin:frontmatter"');
    expect(html).not.toContain('id="robin:blocks"');
    expect(html).not.toContain('<script');
  });

  it('bumps robin:version from 0.1 to 0.2', () => {
    const { html } = migrateV01ToV02(V01_FIXTURE);
    expect(html).toContain('<meta name="robin:version" content="0.2">');
    expect(html).not.toContain('<meta name="robin:version" content="0.1">');
  });

  it('preserves the article body exactly', () => {
    const { html } = migrateV01ToV02(V01_FIXTURE);
    const articleStart = html.indexOf('<article');
    const articleEnd = html.indexOf('</article>') + '</article>'.length;
    const article = html.slice(articleStart, articleEnd);
    expect(article).toContain('<h1>Test Page</h1>');
    expect(article).toContain('data-wiki="other-page"');
    expect(article).toContain('Hello');
  });

  it('produces the expected v0.2 fixture byte-for-byte', () => {
    const { html } = migrateV01ToV02(V01_FIXTURE);
    expect(html).toBe(V02_EXPECTED);
  });

  it('is idempotent on a v0.2 file', () => {
    const { html: once, changed: changedOnce } = migrateV01ToV02(V01_FIXTURE);
    expect(changedOnce).toBe(true);
    const { html: twice, changed: changedTwice } = migrateV01ToV02(once);
    expect(changedTwice).toBe(false);
    expect(twice).toBe(once);
  });

  it('is idempotent on the expected v0.2 fixture directly', () => {
    const { html, changed } = migrateV01ToV02(V02_EXPECTED);
    expect(changed).toBe(false);
    expect(html).toBe(V02_EXPECTED);
  });

  it('inserts robin:version when missing', () => {
    const noVersion = V01_FIXTURE.replace(
      /\s*<meta name="robin:version" content="0\.1">/,
      '',
    );
    const { html } = migrateV01ToV02(noVersion);
    expect(html).toContain('<meta name="robin:version" content="0.2">');
  });

  it('preserves all non-version robin:* meta tags untouched', () => {
    const { html } = migrateV01ToV02(V01_FIXTURE);
    expect(html).toContain('<meta name="robin:slug" content="test-page">');
    expect(html).toContain('<meta name="robin:type" content="note">');
    expect(html).toContain('<meta name="robin:tag" content="alpha">');
    expect(html).toContain('<meta name="robin:tag" content="beta">');
    expect(html).toContain('<meta name="robin:updated" content="2026-05-26T00:00:00Z">');
  });

  it('preserves the <link rel="canonical"> tag', () => {
    const { html } = migrateV01ToV02(V01_FIXTURE);
    expect(html).toContain('<link rel="canonical" href="/p/test-page">');
  });
});
