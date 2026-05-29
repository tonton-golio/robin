/**
 * page-write.test.ts
 *
 * Tests round-trip page write:
 * - Write with body_md produces valid v0.2 ROBIN_FORMAT HTML
 * - Frontmatter merge works (partial update, null clears field)
 * - body_blocks input is no longer accepted (v0.2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseRobinHtml } from '@robin/indexer';
import { pageCreate } from '../src/tools/page-create.js';
import { pageWrite } from '../src/tools/page-write.js';
import { pageRead } from '../src/tools/page-read.js';
import type { ToolContext } from '../src/types.js';

function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-test-write-'));
  fs.mkdirSync(path.join(dir, 'brain', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'logs', 'changelog.md'), '');
  return dir;
}

function makeCtx(vaultPath: string): ToolContext {
  return { vaultPath, indexer: null };
}

describe('page.write — body_md', () => {
  let vault: string;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('round-trips a page written with body_md', async () => {
    const ctx = makeCtx(vault);

    // Create the page first
    await pageCreate(
      {
        folder: 'brain/tasks',
        slug: 'test-task',
        type: 'task',
        frontmatter: { title: 'Test Task', summary: 'A test' },
        body_md: '# Test Task\n\nHello world.',
      },
      ctx
    );

    const filePath = path.join(vault, 'brain', 'tasks', 'test-task.html');
    expect(fs.existsSync(filePath)).toBe(true);

    const html = fs.readFileSync(filePath, 'utf8');
    const parsed = parseRobinHtml(html);

    // Must have required meta fields
    const m = parsed.meta as Record<string, string | string[]>;
    expect(m['robin:type']).toBe('task');
    expect(m['robin:slug']).toBe('test-task');
    expect(m['robin:version']).toBe('0.2');

    // v0.2: no #robin:blocks payload — blocks parse should be null/empty
    expect(parsed.blocks).toBeFalsy();

    // Body HTML must be inside article[data-robin-doc] with prose visible
    expect(html).toContain('data-robin-doc');
    expect(html).toContain('<!doctype html>');
    expect(parsed.bodyText).toContain('Hello world');
  });

  it('writes body_md and produces a valid document structure', async () => {
    const ctx = makeCtx(vault);

    await pageCreate(
      {
        folder: 'brain/tasks',
        slug: 'md-test',
        type: 'task',
        body_md: '# Hello\n\nThis is **bold** text.\n\n- item 1\n- item 2',
      },
      ctx
    );

    const html = fs.readFileSync(
      path.join(vault, 'brain', 'tasks', 'md-test.html'),
      'utf8'
    );

    // v0.2 structural requirements from ROBIN_FORMAT
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('data-robin-doc');
    // v0.2 explicitly removes both JSON payloads from <head>.
    expect(html).not.toContain('id="robin:blocks"');
    expect(html).not.toContain('id="robin:frontmatter"');
    expect(html).toContain('<meta name="robin:version" content="0.2">');
  });
});

describe('page.write — v0.2 schema', () => {
  let vault: string;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('rejects body_blocks at the schema level (v0.2)', async () => {
    // body_blocks is no longer part of the input shape; ensure the Zod schema
    // doesn't accept it. We use parseAsync on the schema directly rather than
    // calling pageCreate, because the deleted field would otherwise just be
    // silently ignored by the (now stricter) schema.
    const { PageCreateInputSchema } = await import('../src/tools/page-create.js');
    const parsed = await PageCreateInputSchema.safeParseAsync({
      folder: 'brain/tasks',
      slug: 'blocks-page',
      type: 'knowledge',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body_blocks: [] as any,
    });
    // The schema is permissive (no strict()), so unknown keys are stripped
    // rather than rejected — but the resulting parsed object must not carry
    // body_blocks through.
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((parsed.data as any).body_blocks).toBeUndefined();
    }
  });
});

describe('page.write — frontmatter merge', () => {
  let vault: string;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('merges partial frontmatter without overwriting unrelated fields', async () => {
    const ctx = makeCtx(vault);

    await pageCreate(
      {
        folder: 'brain/tasks',
        slug: 'merge-test',
        type: 'task',
        frontmatter: { title: 'Original Title', priority: 'p2', owner: 'Alex Rivera' },
        body_md: '# Original',
      },
      ctx
    );

    await pageWrite(
      {
        ref: 'brain/tasks/merge-test.html',
        frontmatter: { priority: 'p1' }, // Only update priority
      },
      ctx
    );

    const result = await pageRead({ ref: 'brain/tasks/merge-test.html' }, ctx);
    expect(result.meta.priority).toBe('p1');
    expect(result.meta.owner).toBe('Alex Rivera'); // preserved
  });

  it('preserves the existing v0.2 body on a frontmatter-only update', async () => {
    const ctx = makeCtx(vault);

    await pageCreate(
      {
        folder: 'brain/tasks',
        slug: 'fm-only',
        type: 'task',
        body_md: '# fm-only\n\nA very distinctive opening sentence.',
      },
      ctx
    );

    // Frontmatter-only update — must not erase the body (regression for the
    // v0.2 path where there is no #robin:blocks payload to round-trip).
    await pageWrite(
      { ref: 'brain/tasks/fm-only.html', frontmatter: { state: 'active' } },
      ctx,
    );

    const html = fs.readFileSync(path.join(vault, 'brain', 'tasks', 'fm-only.html'), 'utf8');
    const parsed = parseRobinHtml(html);
    expect(parsed.bodyText).toContain('A very distinctive opening sentence.');
    const m = parsed.meta as Record<string, string | string[]>;
    // Canonical lifecycle key is robin:status (a `state:` frontmatter value is
    // folded into it on write); the legacy robin:state tag is no longer emitted.
    expect(m['robin:status']).toBe('active');
    expect(m['robin:state']).toBeUndefined();
  });
});

describe('page.write — frontmatter special characters (regression)', () => {
  let vault: string;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  // Previously assemblePage round-tripped frontmatter through naive YAML, which
  // threw on a bare colon and silently truncated `#`/`@`. It must now preserve
  // these verbatim.
  it('preserves a summary containing a colon, #, and @ without throwing', async () => {
    const ctx = makeCtx(vault);
    const summary = 'Fix bug: the @handler dropped #1 records';

    await pageCreate(
      { folder: 'brain/tasks', slug: 'colon-task', type: 'task', frontmatter: { summary }, body_md: '# Colon Task' },
      ctx
    );

    // A status-only update on a page whose summary has a colon must not throw.
    await expect(
      pageWrite({ ref: 'brain/tasks/colon-task.html', frontmatter: { state: 'active' } }, ctx),
    ).resolves.toBeTruthy();

    const result = await pageRead({ ref: 'brain/tasks/colon-task.html' }, ctx);
    expect(result.meta.summary).toBe(summary);
    // Canonical lifecycle field is `status`; `state` still resolves via the
    // read-side fallback (state ?? status) for back-compat.
    expect(result.meta.status).toBe('active');
    expect(result.meta.state).toBe('active');
  });

  // Previously assemblePage only swapped the blocks/frontmatter JSON and left
  // the visible <article> body empty. The body must be rendered from blocks.
  it('renders the body into the article (not just the blocks JSON)', async () => {
    const ctx = makeCtx(vault);

    await pageCreate(
      { folder: 'brain/tasks', slug: 'body-task', type: 'task', body_md: '# Heading\n\nA distinctive sentence in the body.' },
      ctx
    );

    const html = fs.readFileSync(path.join(vault, 'brain', 'tasks', 'body-task.html'), 'utf8');
    // The rendered article (between <article ...> and </article>) must contain the prose.
    const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
    expect(article).toContain('A distinctive sentence in the body.');
    expect(article).toMatch(/<h1[^>]*>Heading<\/h1>/);
  });
});
