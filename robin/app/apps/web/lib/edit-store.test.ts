import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeWithHistory } from '@robin/vault-io';
import { listEdits, findEdit, groupEditsByPage } from './edit-store';
import { revertToSnapshot } from './actions/edit';

describe('edit-store + back-step round-trip', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-edits-'));
    process.env['ROBIN_VAULT'] = vault;
  });
  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
    delete process.env['ROBIN_VAULT'];
  });

  it('lists + groups + finds edits, then reverts to a snapshot', async () => {
    const abs = path.join(vault, 'brain', 'foo.html');
    await writeWithHistory({ absolutePath: abs, html: '<p>v1</p>', origin: 'web', vaultRoot: vault });
    const saved = await writeWithHistory({
      absolutePath: abs,
      html: '<p>v2</p>',
      origin: 'web',
      vaultRoot: vault,
    });

    const edits = await listEdits();
    expect(edits).toHaveLength(2);
    expect(edits.map((e) => e.event).sort()).toEqual(['edit.created', 'edit.saved']);

    const groups = groupEditsByPage(edits);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.pagePath).toBe('brain/foo.html');

    const savedId = saved.event!.id;
    expect((await findEdit(savedId))?.id).toBe(savedId);

    // The 'edit.saved' event's snapshot holds v1 → reverting restores v1.
    const res = await revertToSnapshot(savedId);
    expect(res.ok).toBe(true);
    expect(await fs.readFile(abs, 'utf-8')).toBe('<p>v1</p>');

    // The restore is itself logged as a reversible edit.
    const after = await listEdits();
    expect(after.some((e) => e.event === 'edit.reverted')).toBe(true);
    expect(after.length).toBe(3);
  });

  it('refuses to revert a create (no snapshot)', async () => {
    const abs = path.join(vault, 'brain', 'bar.html');
    const created = await writeWithHistory({
      absolutePath: abs,
      html: '<p>x</p>',
      origin: 'web',
      vaultRoot: vault,
    });
    const res = await revertToSnapshot(created.event!.id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/snapshot/);
  });

  it('reports a not-found revert cleanly', async () => {
    const res = await revertToSnapshot('does-not-exist');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/);
  });
});
