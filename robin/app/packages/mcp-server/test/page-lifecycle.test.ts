/**
 * page-lifecycle.test.ts
 *
 * Regression coverage for the page.create / page.move / page.delete hardening:
 *   - page.create rejects an ALLOWED_ROOTS bypass via '..' ('brain/../.claude')
 *   - page.move refuses to overwrite an existing destination (no silent clobber)
 *   - page.delete archive disambiguates instead of clobbering a prior archive
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pageCreate } from '../src/tools/page-create.js';
import { pageMove } from '../src/tools/page-move.js';
import { pageDelete } from '../src/tools/page-delete.js';
import type { ToolContext } from '../src/types.js';

function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-test-pl-'));
  fs.mkdirSync(path.join(dir, 'brain'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  return dir;
}

function makeCtx(vaultPath: string): ToolContext {
  return { vaultPath, indexer: null };
}

describe('page.create — ALLOWED_ROOTS bypass', () => {
  let vault: string;
  beforeEach(() => { vault = makeVault(); });
  afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

  it("rejects a folder that escapes an allowed root via '..' (brain/../.claude)", async () => {
    const ctx = makeCtx(vault);
    await expect(
      pageCreate({ folder: 'brain/../.claude', slug: 'evil', type: 'note' }, ctx)
    ).rejects.toThrow(/under brain\//);
    // And nothing was written into the control-plane dir.
    expect(fs.existsSync(path.join(vault, '.claude', 'evil.html'))).toBe(false);
  });

  it('still allows a legitimate nested folder under brain/', async () => {
    const ctx = makeCtx(vault);
    const res = await pageCreate(
      { folder: 'brain/tasks', slug: 'ok', type: 'task' },
      ctx
    );
    expect(res.path).toBe('brain/tasks/ok.html');
    expect(fs.existsSync(path.join(vault, 'brain', 'tasks', 'ok.html'))).toBe(true);
  });
});

describe('page.move — destination collision', () => {
  let vault: string;
  beforeEach(() => { vault = makeVault(); });
  afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

  it('refuses to overwrite an existing destination page', async () => {
    const ctx = makeCtx(vault);
    await pageCreate({ folder: 'brain', slug: 'src', type: 'note', body_md: '# Src\n\nSOURCE-MARKER.' }, ctx);
    await pageCreate({ folder: 'brain', slug: 'dst', type: 'note', body_md: '# Dst\n\nDEST-MARKER.' }, ctx);

    await expect(
      pageMove({ from_ref: 'brain/src.html', to_path: 'brain/dst.html' }, ctx)
    ).rejects.toThrow(/already exists/);

    // The destination is intact (not clobbered) and the source still exists.
    const dst = fs.readFileSync(path.join(vault, 'brain', 'dst.html'), 'utf8');
    expect(dst).toContain('DEST-MARKER.');
    expect(fs.existsSync(path.join(vault, 'brain', 'src.html'))).toBe(true);
  });

  it('moves to a free destination as before', async () => {
    const ctx = makeCtx(vault);
    await pageCreate({ folder: 'brain', slug: 'mover', type: 'note', body_md: '# Mover' }, ctx);
    const res = await pageMove({ from_ref: 'brain/mover.html', to_path: 'brain/moved.html' }, ctx);
    expect(res.new_path).toBe('brain/moved.html');
    expect(fs.existsSync(path.join(vault, 'brain', 'moved.html'))).toBe(true);
    expect(fs.existsSync(path.join(vault, 'brain', 'mover.html'))).toBe(false);
  });
});

describe('page.delete — archive disambiguation', () => {
  let vault: string;
  beforeEach(() => { vault = makeVault(); });
  afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); });

  it('does not clobber a prior archived file of the same basename', async () => {
    const ctx = makeCtx(vault);

    // Create + archive once.
    await pageCreate({ folder: 'brain', slug: 'recur', type: 'note', body_md: '# Recur\n\nFIRST-VERSION.' }, ctx);
    const first = await pageDelete({ ref: 'brain/recur.html' }, ctx);
    expect(first.archived_to).toBe(path.join('brain', 'archive', 'recur.html'));

    // Recreate + archive again — must NOT overwrite the first archived snapshot.
    await pageCreate({ folder: 'brain', slug: 'recur', type: 'note', body_md: '# Recur\n\nSECOND-VERSION.' }, ctx);
    const second = await pageDelete({ ref: 'brain/recur.html' }, ctx);
    expect(second.archived_to).not.toBe(first.archived_to);

    // Both archived snapshots survive with their distinct content.
    const firstArchived = fs.readFileSync(path.join(vault, first.archived_to!), 'utf8');
    const secondArchived = fs.readFileSync(path.join(vault, second.archived_to!), 'utf8');
    expect(firstArchived).toContain('FIRST-VERSION.');
    expect(secondArchived).toContain('SECOND-VERSION.');
  });
});
