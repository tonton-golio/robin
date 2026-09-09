import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ vault: '' }));
vi.mock('@/lib/vault', () => ({ locateVault: () => state.vault }));
vi.mock('@/lib/read-page', () => ({ readPage: async () => ({ error: 'generic artifact' }) }));
import { listOutputs } from './catalog';

afterEach(async () => { if (state.vault) await fs.rm(state.vault, { recursive: true, force: true }); });

it('finds archived posters and shared format companions without listing thumbnails as artifacts', async () => {
  state.vault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-output-catalog-'));
  await fs.mkdir(path.join(state.vault, 'out/archive'), { recursive: true });
  for (const file of ['deck.html', 'deck.pptx', 'deck.poster.jpg', 'clip.mp4', 'clip.poster.jpg', 'unrendered.html', 'archive/_index.html', 'archive/_index.poster.jpg']) {
    await fs.writeFile(path.join(state.vault, 'out', file), 'fixture');
  }
  const items = await listOutputs();
  expect(items).toHaveLength(5);
  const byPath = new Map(items.map(item => [item.path, item]));
  expect(byPath.get('out/deck.html')?.poster).toBe('out/deck.poster.jpg');
  expect(byPath.get('out/deck.pptx')?.poster).toBe('out/deck.poster.jpg');
  expect(byPath.get('out/clip.mp4')?.poster).toBe('out/clip.poster.jpg');
  expect(byPath.get('out/clip.mp4')?.href).toBe('/file/out/clip.mp4');
  expect(byPath.get('out/archive/_index.html')?.poster).toBe('out/archive/_index.poster.jpg');
  expect(byPath.get('out/unrendered.html')?.poster).toBeUndefined();
});
