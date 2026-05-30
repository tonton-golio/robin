/**
 * task-and-link.test.ts
 *
 * Covers the canonical-status convention and the new/fixed write tools:
 *   - task.create stamps canonical robin:status="open" (not robin:state)
 *   - task.create changelog line uses the canonical convention
 *   - task.update moves status + writes a changelog line + preserves body
 *   - link.add writes a DURABLE wikilink into the source page body
 *   - page.list (filesystem fallback) sets title from <title>, not robin:type
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseRobinHtml } from '@robin/indexer';
import { pageCreate } from '../src/tools/page-create.js';
import { taskCreate } from '../src/tools/task-create.js';
import { taskUpdate } from '../src/tools/task-update.js';
import { linkAdd } from '../src/tools/link-add.js';
import { pageList } from '../src/tools/page-list.js';
import type { ToolContext } from '../src/types.js';

function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-test-tl-'));
  fs.mkdirSync(path.join(dir, 'brain', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'logs', 'changelog.md'), '');
  return dir;
}

function makeCtx(vaultPath: string): ToolContext {
  return { vaultPath, indexer: null };
}

describe('task.create — canonical status', () => {
  let vault: string;
  beforeEach(() => { vault = makeVault(); });
  afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

  it('stamps robin:status="open" and never robin:state', async () => {
    const ctx = makeCtx(vault);
    const res = await taskCreate({ title: 'Ship the thing', summary: 'A summary' }, ctx);

    const html = fs.readFileSync(path.join(vault, res.path), 'utf8');
    const m = parseRobinHtml(html).meta as Record<string, string | string[]>;
    expect(m['robin:status']).toBe('open');
    expect(m['robin:state']).toBeUndefined();
    expect(m['robin:type']).toBe('task');
  });

  it('writes the canonical changelog convention', async () => {
    const ctx = makeCtx(vault);
    const res = await taskCreate({ title: 'Ship the thing', summary: 'A summary' }, ctx);
    expect(res.log_entry).toMatch(/^## \[\d{4}-\d{2}-\d{2}\] task \| Created \[\[ship-the-thing\]\] — A summary$/);

    const changelog = fs.readFileSync(path.join(vault, 'logs', 'changelog.md'), 'utf8');
    expect(changelog).toContain('task | Created [[ship-the-thing]]');
    // The old duplicated-header shape must be gone.
    expect(changelog).not.toContain('- **task** | Created:');
  });
});

describe('task.update', () => {
  let vault: string;
  beforeEach(() => { vault = makeVault(); });
  afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

  it('moves status to done, preserves the body, and logs the change', async () => {
    const ctx = makeCtx(vault);
    await taskCreate({ title: 'Do work', summary: 'orig', body_md: '# Do work\n\nA distinctive body sentence.' }, ctx);

    const res = await taskUpdate(
      { ref: 'brain/tasks/do-work.html', status: 'done', priority: 'p1', note: 'shipped' },
      ctx
    );
    expect(res.status).toBe('done');

    const html = fs.readFileSync(path.join(vault, 'brain', 'tasks', 'do-work.html'), 'utf8');
    const parsed = parseRobinHtml(html);
    const m = parsed.meta as Record<string, string | string[]>;
    expect(m['robin:status']).toBe('done');
    expect(m['robin:state']).toBeUndefined();
    expect(m['robin:priority']).toBe('p1');
    // Body preserved.
    expect(parsed.bodyText).toContain('A distinctive body sentence.');

    const changelog = fs.readFileSync(path.join(vault, 'logs', 'changelog.md'), 'utf8');
    expect(changelog).toMatch(/task \| Updated \[\[do-work\]\] \(status → done, priority → p1\) — shipped/);
  });

  it('rejects a no-op update', async () => {
    const ctx = makeCtx(vault);
    await taskCreate({ title: 'Empty update' }, ctx);
    await expect(
      taskUpdate({ ref: 'brain/tasks/empty-update.html' }, ctx)
    ).rejects.toThrow(/at least one of/);
  });

  it('preserves the human <title> and unknown robin:* meta (workflow, category)', async () => {
    const ctx = makeCtx(vault);
    // A real v0.2 page carries robin:workflow / robin:category that the meta
    // vocabulary does not enumerate, and a human <title> that is not the slug.
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Image Generation Feature</title>
  <link rel="canonical" href="/p/images">
  <meta name="robin:version" content="0.2">
  <meta name="robin:slug" content="images">
  <meta name="robin:path" content="brain/tasks/images.html">
  <meta name="robin:type" content="task">
  <meta name="robin:status" content="open">
  <meta name="robin:updated" content="2026-05-01T00:00:00Z">
  <meta name="robin:workflow" content="scheduled">
  <meta name="robin:category" content="beacon">
</head>
<body>
  <article data-robin-doc>
    <p>A distinctive body sentence.</p>
  </article>
</body>
</html>`;
    fs.writeFileSync(path.join(vault, 'brain', 'tasks', 'images.html'), html);

    await taskUpdate({ ref: 'brain/tasks/images.html', status: 'done' }, ctx);

    const out = fs.readFileSync(path.join(vault, 'brain', 'tasks', 'images.html'), 'utf8');
    const parsed = parseRobinHtml(out);
    const m = parsed.meta as Record<string, string | string[]>;
    // Status moved...
    expect(m['robin:status']).toBe('done');
    // ...but the human title and the custom tags survived (the bug clobbered them).
    expect(out).toContain('<title>Image Generation Feature</title>');
    expect(m['robin:workflow']).toBe('scheduled');
    expect(m['robin:category']).toBe('beacon');
    expect(parsed.bodyText).toContain('A distinctive body sentence.');
  });
});

describe('link.add — durable body write', () => {
  let vault: string;
  beforeEach(() => { vault = makeVault(); });
  afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

  it('writes a [[wikilink]] into the source page body that survives reparse', async () => {
    const ctx = makeCtx(vault);
    await pageCreate(
      { folder: 'brain', slug: 'from-page', type: 'note', body_md: '# From Page\n\nSome prose.' },
      ctx
    );
    await pageCreate(
      { folder: 'brain', slug: 'to-page', type: 'note', body_md: '# To Page' },
      ctx
    );

    const res = await linkAdd({ from_ref: 'from-page', to_ref: 'to-page' }, ctx);
    expect(res.created).toBe(true);
    expect(res.from_slug).toBe('from-page');
    expect(res.to_slug).toBe('to-page');

    const html = fs.readFileSync(path.join(vault, 'brain', 'from-page.html'), 'utf8');
    const parsed = parseRobinHtml(html);
    // The durable proof: a real data-wiki anchor the indexer will pick up.
    expect(html).toContain('data-wiki="to-page"');
    expect(parsed.wikilinkTargets).toContain('to-page');
    // Original body preserved.
    expect(parsed.bodyText).toContain('Some prose.');
    expect(html).toContain('Related');
  });

  it('is idempotent — re-adding an existing link does not duplicate', async () => {
    const ctx = makeCtx(vault);
    await pageCreate({ folder: 'brain', slug: 'src', type: 'note', body_md: '# Src' }, ctx);
    await pageCreate({ folder: 'brain', slug: 'dst', type: 'note', body_md: '# Dst' }, ctx);

    const first = await linkAdd({ from_ref: 'src', to_ref: 'dst' }, ctx);
    expect(first.created).toBe(true);
    const second = await linkAdd({ from_ref: 'src', to_ref: 'dst' }, ctx);
    expect(second.created).toBe(false);

    const html = fs.readFileSync(path.join(vault, 'brain', 'src.html'), 'utf8');
    const matches = html.match(/data-wiki="dst"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('keeps a single <ul> under one ## Related after two link.add calls', async () => {
    const ctx = makeCtx(vault);
    await pageCreate({ folder: 'brain', slug: 'hub', type: 'note', body_md: '# Hub' }, ctx);
    await pageCreate({ folder: 'brain', slug: 'a', type: 'note', body_md: '# A' }, ctx);
    await pageCreate({ folder: 'brain', slug: 'b', type: 'note', body_md: '# B' }, ctx);

    await linkAdd({ from_ref: 'hub', to_ref: 'a' }, ctx);
    await linkAdd({ from_ref: 'hub', to_ref: 'b' }, ctx);

    const html = fs.readFileSync(path.join(vault, 'brain', 'hub.html'), 'utf8');
    const parsed = parseRobinHtml(html);
    // Both links are durable...
    expect(parsed.wikilinkTargets).toContain('a');
    expect(parsed.wikilinkTargets).toContain('b');
    // ...but folded into ONE list under ONE heading (the bug appended a 2nd <ul>).
    expect((html.match(/<ul\b/gi) ?? []).length).toBe(1);
    expect((html.match(/>\s*Related\s*</gi) ?? []).length).toBe(1);
  });

  it('does not duplicate when the page already links the target path-like', async () => {
    const ctx = makeCtx(vault);
    // Pre-existing page that links the target by its PATH-like form
    // ([[features/images]]) rather than the bare basename slug.
    fs.mkdirSync(path.join(vault, 'brain', 'features'), { recursive: true });
    await pageCreate({ folder: 'brain/features', slug: 'images', type: 'note', body_md: '# Images' }, ctx);
    await pageCreate(
      { folder: 'brain', slug: 'consumer', type: 'note', body_md: '# Consumer\n\nSee [[features/images]] for details.' },
      ctx
    );

    const res = await linkAdd({ from_ref: 'consumer', to_ref: 'features/images' }, ctx);
    // Already linked path-like → no duplicate bare-slug link written.
    expect(res.created).toBe(false);

    const html = fs.readFileSync(path.join(vault, 'brain', 'consumer.html'), 'utf8');
    expect((html.match(/data-wiki="images"/g) ?? []).length).toBe(0);
    expect((html.match(/data-wiki="features\/images"/g) ?? []).length).toBe(1);
  });

  it('preserves the source page <title> and unknown robin:* meta when adding a link', async () => {
    const ctx = makeCtx(vault);
    await pageCreate({ folder: 'brain', slug: 'target', type: 'note', body_md: '# Target' }, ctx);
    // Hand-author a source page carrying a human title + custom robin:* tags.
    const srcHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Production Deployment Setup</title>
  <link rel="canonical" href="/p/prod-deploy">
  <meta name="robin:version" content="0.2">
  <meta name="robin:slug" content="prod-deploy">
  <meta name="robin:path" content="brain/prod-deploy.html">
  <meta name="robin:type" content="task">
  <meta name="robin:workflow" content="scheduled">
  <meta name="robin:category" content="infra">
</head>
<body>
  <article data-robin-doc>
    <p>Original prose here.</p>
  </article>
</body>
</html>`;
    fs.writeFileSync(path.join(vault, 'brain', 'prod-deploy.html'), srcHtml);

    const res = await linkAdd({ from_ref: 'brain/prod-deploy.html', to_ref: 'target' }, ctx);
    expect(res.created).toBe(true);

    const out = fs.readFileSync(path.join(vault, 'brain', 'prod-deploy.html'), 'utf8');
    const parsed = parseRobinHtml(out);
    const m = parsed.meta as Record<string, string | string[]>;
    expect(out).toContain('<title>Production Deployment Setup</title>');
    expect(m['robin:workflow']).toBe('scheduled');
    expect(m['robin:category']).toBe('infra');
    // The link itself is durable and the original prose survived.
    expect(parsed.wikilinkTargets).toContain('target');
    expect(parsed.bodyText).toContain('Original prose here.');
  });
});

describe('page.list — filesystem fallback title', () => {
  let vault: string;
  beforeEach(() => { vault = makeVault(); });
  afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

  it('sets title from the document <title>, not robin:type', async () => {
    const ctx = makeCtx(vault);
    await pageCreate(
      { folder: 'brain/tasks', slug: 'titled-task', type: 'task', frontmatter: { title: 'A Human Title' }, body_md: '# A Human Title' },
      ctx
    );

    const out = await pageList({ type: 'task' }, ctx);
    const item = out.items.find((i) => i.slug === 'titled-task');
    expect(item).toBeDefined();
    expect(item!.title).toBe('A Human Title');
    // Regression: title must NOT be the robin:type value.
    expect(item!.title).not.toBe('task');
  });
});
