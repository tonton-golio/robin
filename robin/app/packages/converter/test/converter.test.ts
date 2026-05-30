import { describe, it, expect } from 'vitest';
import { convertMarkdown } from '../src/index.js';

describe('convertMarkdown — smoke', () => {
  it('produces a complete HTML document with required head meta', () => {
    const md = `---
type: knowledge
summary: A test page
updated: 2026-05-01
tags: [test, smoke]
---

# Hello

A paragraph with a [[wikilink]] and **bold**.
`;
    const { html, meta, blocks } = convertMarkdown(md, {
      outputPath: 'brain/hello.html',
    });
    expect(html).toMatch(/<!doctype html>/);
    expect(html).toContain('<meta name="robin:slug" content="hello">');
    expect(html).toContain('<meta name="robin:type" content="knowledge">');
    expect(html).toContain('<meta name="robin:tag" content="smoke">');
    expect(html).toContain('<meta name="robin:tag" content="test">');
    expect(html).toContain('<a data-wiki="wikilink"');
    expect(meta.slug).toBe('hello');
    expect(meta.tags).toEqual(expect.arrayContaining(['test', 'smoke']));
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('handles Obsidian callouts', () => {
    const md = `# Title

> [!note] Important
> Body of the callout.
`;
    const { html, blocks } = convertMarkdown(md, { outputPath: 'brain/c.html' });
    const calloutBlock = blocks.find((b) => b.kind === 'callout');
    expect(calloutBlock).toBeDefined();
    expect((calloutBlock as { calloutType: string }).calloutType).toBe('note');
    expect(html).toContain('data-callout="note"');
  });

  it('handles task lists', () => {
    const md = `# T

- [ ] open
- [x] done
`;
    const { html, blocks } = convertMarkdown(md, { outputPath: 'brain/t.html' });
    const list = blocks.find((b) => b.kind === 'taskList');
    expect(list).toBeDefined();
    expect(html).toContain('data-block="taskList"');
    expect(html).toContain('data-checked="false"');
    expect(html).toContain('data-checked="true"');
  });

  it('handles code blocks without recursing into wikilinks', () => {
    const md = `# C

\`\`\`python
def foo():
    return "[[not-a-wikilink]]"
\`\`\`
`;
    const { html } = convertMarkdown(md, { outputPath: 'brain/code.html' });
    expect(html).toContain('data-lang="python"');
    // Wikilink syntax inside code must NOT become an <a> tag.
    expect(html).toContain('[[not-a-wikilink]]');
    expect(html).not.toMatch(/<a[^>]*data-wiki="not-a-wikilink"/);
  });

  it('treats wikilink with alias correctly', () => {
    const md = `Hello [[sam-park|Sam]]`;
    const { html } = convertMarkdown(md, { outputPath: 'brain/w.html' });
    expect(html).toContain('data-wiki="sam-park"');
    expect(html).toContain('Sam');
  });

  it('is idempotent on output (running the JSON serializer twice = same string)', () => {
    const md = `---
type: task
tags: [b, a, c]
---

Body.
`;
    const r1 = convertMarkdown(md, { outputPath: 'brain/x.html' });
    const r2 = convertMarkdown(md, { outputPath: 'brain/x.html' });
    expect(r1.html).toBe(r2.html);
  });
});
