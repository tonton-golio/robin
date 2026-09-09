import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeWithHistory, hashHtml } from '../src/index.js';

describe('writeWithHistory', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-vault-io-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes a new file (beforeHash null, written true) and creates parent dirs', async () => {
    const target = path.join(dir, 'brain', 'nested', 'page.html');
    const html = '<!doctype html><title>x</title>';

    const res = await writeWithHistory({ absolutePath: target, html, origin: 'web' });

    expect(res.written).toBe(true);
    expect(res.beforeHash).toBeNull();
    expect(res.afterHash).toBe(hashHtml(html));
    expect(res.origin).toBe('web');
    expect(await fs.readFile(target, 'utf8')).toBe(html);
  });

  it('is a no-op when the new bytes are byte-identical (write skipped, mtime unchanged)', async () => {
    const target = path.join(dir, 'page.html');
    const html = '<!doctype html><title>same</title>';

    const first = await writeWithHistory({ absolutePath: target, html });
    expect(first.written).toBe(true);
    const mtime1 = (await fs.stat(target)).mtimeMs;

    // Force a measurable clock gap so a mtime bump would be observable.
    await new Promise((r) => setTimeout(r, 15));

    const second = await writeWithHistory({ absolutePath: target, html });
    expect(second.written).toBe(false);
    expect(second.beforeHash).toBe(second.afterHash);
    const mtime2 = (await fs.stat(target)).mtimeMs;
    expect(mtime2).toBe(mtime1);
  });

  it('writes when content differs (beforeHash reflects prior bytes)', async () => {
    const target = path.join(dir, 'page.html');
    const v1 = '<!doctype html><title>v1</title>';
    const v2 = '<!doctype html><title>v2</title>';

    await writeWithHistory({ absolutePath: target, html: v1 });
    const res = await writeWithHistory({ absolutePath: target, html: v2 });

    expect(res.written).toBe(true);
    expect(res.beforeHash).toBe(hashHtml(v1));
    expect(res.afterHash).toBe(hashHtml(v2));
    expect(await fs.readFile(target, 'utf8')).toBe(v2);
  });

  it('leaves no .tmp litter after a successful write', async () => {
    const target = path.join(dir, 'page.html');
    await writeWithHistory({ absolutePath: target, html: '<p>a</p>' });
    await writeWithHistory({ absolutePath: target, html: '<p>b</p>' });

    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.includes('.tmp'))).toEqual([]);
    expect(entries).toContain('page.html');
  });

  it('hashHtml is deterministic and content-sensitive', () => {
    expect(hashHtml('a')).toBe(hashHtml('a'));
    expect(hashHtml('a')).not.toBe(hashHtml('b'));
  });
});
