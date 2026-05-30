/**
 * Tests for parseRobinHtml().
 *
 * Uses a golden file from the converter test suite as fixture.
 * Also tests in-memory with a hand-crafted minimal HTML string.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseRobinHtml } from '../src/parse-html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the golden test file in the converter package
const GOLDEN_APE = path.resolve(
  __dirname,
  '../../converter/test/golden/04-project.expected.html'
);
const GOLDEN_INDEX = path.resolve(
  __dirname,
  '../../converter/test/golden/03-brain-index.expected.html'
);

describe('parseRobinHtml — minimal inline HTML', () => {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test Page</title>
  <meta name="robin:slug" content="test-page">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-05-26T00:00:00Z">
  <meta name="robin:summary" content="A test page">
  <meta name="robin:tag" content="alpha">
  <meta name="robin:tag" content="beta">
  <script type="application/json" id="robin:frontmatter">
{"title": "Test Page", "type": "note"}
  </script>
  <script type="application/json" id="robin:blocks">
[{"kind": "paragraph", "content": [{"kind": "text", "text": "Hello world"}]}]
  </script>
</head>
<body>
  <article data-robin-doc>
    <p>Hello world. See <a data-wiki="other-page" href="/p/other-page">other-page</a>.</p>
    <p>Also see <a data-wiki="another-page" href="/p/another-page">another</a> page.</p>
  </article>
</body>
</html>`;

  it('extracts slug', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.meta['robin:slug']).toBe('test-page');
  });

  it('extracts type', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.meta['robin:type']).toBe('note');
  });

  it('accumulates repeated tags into array', () => {
    const parsed = parseRobinHtml(html);
    const tags = parsed.meta['robin:tag'];
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toContain('alpha');
    expect(tags).toContain('beta');
    expect((tags as string[]).length).toBe(2);
  });

  it('extracts wikilink targets', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.wikilinkTargets).toContain('other-page');
    expect(parsed.wikilinkTargets).toContain('another-page');
    expect(parsed.wikilinkTargets.length).toBe(2);
  });

  it('extracts non-empty bodyText', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.bodyText.length).toBeGreaterThan(0);
    expect(parsed.bodyText).toContain('Hello world');
  });

  it('parses frontmatter JSON', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.frontmatter).toEqual({ title: 'Test Page', type: 'note' });
  });

  it('parses blocks JSON', () => {
    const parsed = parseRobinHtml(html);
    expect(Array.isArray(parsed.blocks)).toBe(true);
    expect((parsed.blocks as unknown[]).length).toBeGreaterThan(0);
  });

  it('returns bodyHtml containing article content', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.bodyHtml).toContain('Hello world');
    expect(parsed.bodyHtml).toContain('data-wiki');
  });
});

describe('parseRobinHtml — v0.2 (no script payloads)', () => {
  const v02Html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>v0.2 Page</title>
  <link rel="canonical" href="/p/v02-page">
  <meta name="robin:version" content="0.2">
  <meta name="robin:slug" content="v02-page">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-05-28T00:00:00Z">
  <meta name="robin:tag" content="alpha">
</head>
<body>
  <article data-robin-doc>
    <h1>v0.2 Page</h1>
    <p>Body with a <a data-wiki="other" href="/p/other">link</a>.</p>
  </article>
</body>
</html>`;

  it('returns null frontmatter when the script tag is absent', () => {
    const parsed = parseRobinHtml(v02Html);
    expect(parsed.frontmatter).toBeNull();
  });

  it('returns null blocks when the script tag is absent', () => {
    const parsed = parseRobinHtml(v02Html);
    expect(parsed.blocks).toBeNull();
  });

  it('still extracts meta, bodyText, and wikilink targets', () => {
    const parsed = parseRobinHtml(v02Html);
    expect(parsed.meta['robin:slug']).toBe('v02-page');
    expect(parsed.meta['robin:version']).toBe('0.2');
    expect(parsed.meta['robin:tag']).toBe('alpha');
    expect(parsed.bodyText).toContain('Body with a');
    expect(parsed.wikilinkTargets).toContain('other');
  });

  it('extracts non-empty bodyHtml from the article', () => {
    const parsed = parseRobinHtml(v02Html);
    expect(parsed.bodyHtml).toContain('<h1>v0.2 Page</h1>');
    expect(parsed.bodyHtml).toContain('data-wiki="other"');
  });
});

describe('parseRobinHtml — bodyHtml serializer emits real HTML attribute names', () => {
  // Regression: serializeToHtml previously returned hast's React/DOM property
  // names verbatim (className, colSpan, htmlFor, strokeWidth) for everything but
  // data-*. Frontmatter-only writes splice bodyHtml back to disk, so that
  // corrupted the durable brain: class= became className= (CSS dropped), colspan=
  // became colSpan= (tables collapsed), inline-SVG attrs broke.
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Attr Page</title>
  <meta name="robin:slug" content="attr-page">
  <meta name="robin:type" content="note">
</head>
<body>
  <article data-robin-doc>
    <p class="lead" data-tone="warm">Lead.<wbr>break</p>
    <table><tbody><tr><td colspan="2" rowspan="3">cell</td></tr></tbody></table>
    <label for="field">Label</label>
    <svg viewBox="0 0 10 10" preserveAspectRatio="xMidYMid">
      <path stroke-width="2" d="M0 0"></path>
      <use xlink:href="#a"></use>
    </svg>
  </article>
</body>
</html>`;

  it('maps className → class (not className=)', () => {
    const { bodyHtml } = parseRobinHtml(html);
    expect(bodyHtml).toContain('class="lead"');
    expect(bodyHtml).not.toContain('className');
  });

  it('maps colSpan/rowSpan → colspan/rowspan', () => {
    const { bodyHtml } = parseRobinHtml(html);
    expect(bodyHtml).toContain('colspan="2"');
    expect(bodyHtml).toContain('rowspan="3"');
    expect(bodyHtml).not.toContain('colSpan');
    expect(bodyHtml).not.toContain('rowSpan');
  });

  it('maps htmlFor → for', () => {
    const { bodyHtml } = parseRobinHtml(html);
    expect(bodyHtml).toContain('for="field"');
    expect(bodyHtml).not.toContain('htmlFor');
  });

  it('preserves SVG camelCase attrs (viewBox, preserveAspectRatio) verbatim', () => {
    const { bodyHtml } = parseRobinHtml(html);
    expect(bodyHtml).toContain('viewBox="0 0 10 10"');
    expect(bodyHtml).toContain('preserveAspectRatio="xMidYMid"');
    expect(bodyHtml).not.toContain('view-box');
  });

  it('kebab-cases hyphenated SVG props back (strokeWidth → stroke-width)', () => {
    const { bodyHtml } = parseRobinHtml(html);
    expect(bodyHtml).toContain('stroke-width="2"');
    expect(bodyHtml).not.toContain('strokeWidth');
  });

  it('restores the xlink:href namespace (not x-link-href)', () => {
    const { bodyHtml } = parseRobinHtml(html);
    expect(bodyHtml).toContain('xlink:href="#a"');
    expect(bodyHtml).not.toContain('x-link-href');
  });

  it('emits <wbr> as a void tag (no </wbr>)', () => {
    const { bodyHtml } = parseRobinHtml(html);
    expect(bodyHtml).toContain('<wbr>');
    expect(bodyHtml).not.toContain('</wbr>');
  });

  it('keeps data-* attributes kebab-cased', () => {
    const { bodyHtml } = parseRobinHtml(html);
    expect(bodyHtml).toContain('data-tone="warm"');
  });
});

describe('parseRobinHtml — golden file 03-brain-index', () => {
  const html = fs.readFileSync(GOLDEN_INDEX, 'utf-8');

  it('extracts slug "03-brain-index"', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.meta['robin:slug']).toBe('03-brain-index');
  });

  it('extracts type "index"', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.meta['robin:type']).toBe('index');
  });

  it('has non-empty bodyText', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.bodyText.length).toBeGreaterThan(50);
  });

  it('extracts multiple wikilink targets', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.wikilinkTargets.length).toBeGreaterThan(5);
  });

  it('exposes type via canonical meta tag (v0.2: no frontmatter script)', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.frontmatter).toBeNull();
    expect(parsed.meta['robin:type']).toBe('index');
  });
});

describe('parseRobinHtml — golden file 04-project (project with tags)', () => {
  const html = fs.readFileSync(GOLDEN_APE, 'utf-8');

  it('extracts slug "04-project"', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.meta['robin:slug']).toBe('04-project');
  });

  it('extracts type "project"', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.meta['robin:type']).toBe('project');
  });

  it('extracts tag array', () => {
    const parsed = parseRobinHtml(html);
    const tags = parsed.meta['robin:tag'];
    expect(Array.isArray(tags)).toBe(true);
    expect((tags as string[]).length).toBeGreaterThanOrEqual(2);
  });

  it('extracts many wikilink targets', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.wikilinkTargets.length).toBeGreaterThan(10);
    expect(parsed.wikilinkTargets).toContain('jordan-lee');
  });

  it('has long bodyText containing key phrases', () => {
    const parsed = parseRobinHtml(html);
    expect(parsed.bodyText.length).toBeGreaterThan(200);
    expect(parsed.bodyText).toContain('Beacon');
  });
});
