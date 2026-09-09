import { describe, it, expect } from 'vitest';
import { applyTaskPatch, convertMarkdown, normalizeTaskPatch } from '../src/index.js';

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

  it('round-trips the shared task fields into canonical metadata', () => {
    const { html, meta } = convertMarkdown(`---
type: task
project: robin-project
next_action: Draft the migration note
acceptance: The note is reviewed and linked
status: in-progress
priority: p1
kind: workstream
---

# Migration
`, { outputPath: 'brain/tasks/migration.html' });

    expect(meta.project).toBe('robin-project');
    expect(meta.next_action).toBe('Draft the migration note');
    expect(meta.acceptance).toBe('The note is reviewed and linked');
    expect(html).toContain('<meta name="robin:project" content="robin-project">');
    expect(html).toContain('<meta name="robin:next_action" content="Draft the migration note">');
    expect(html).toContain('<meta name="robin:acceptance" content="The note is reviewed and linked">');
  });

  it('normalizes enum casing and clears only explicitly selected fields', () => {
    const patch = normalizeTaskPatch({
      status: 'IN-PROGRESS',
      priority: 'P1',
      kind: 'WORKSTREAM',
      project: null,
      next_action: '',
    });
    expect(patch).toMatchObject({
      status: 'in-progress',
      priority: 'p1',
      kind: 'workstream',
      project: null,
      next_action: null,
    });
    const updated = applyTaskPatch({ project: 'clear me', owner: 'Ada' }, patch);
    expect(updated.owner).toBe('Ada');
    expect(updated.project).toBeUndefined();
    expect(updated.next_action).toBeUndefined();
  });

  it('rejects invalid recognized fields before a patch can be applied', () => {
    expect(() => normalizeTaskPatch({ status: 'unknown' })).toThrow(/invalid task status/);
    expect(() => normalizeTaskPatch({ priority: 'p9' })).toThrow(/invalid task priority/);
    expect(() => normalizeTaskPatch({ kind: 'epic' })).toThrow(/invalid task kind/);
    expect(() => normalizeTaskPatch({ due: '2026-02-30' })).toThrow(/ISO date/);
  });

  it('preserves legacy lifecycle under the canonical status key during unrelated edits', () => {
    const updated = applyTaskPatch(
      { state: 'in-progress', owner: 'Ada', project: 'robin' },
      { owner: 'Sam' },
    );
    expect(updated).toMatchObject({ status: 'in-progress', owner: 'Sam', project: 'robin' });
    expect(updated.state).toBeUndefined();
  });
});
