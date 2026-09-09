import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { fallbackSearch } from './indexer-client';

it('finds retained meetings and reports without including operational logs or inbox originals', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-fallback-'));
  try {
    for (const dir of ['brain', 'out', 'logs/meetings', 'logs/reports', 'logs/private', 'inbox']) {
      await fs.mkdir(path.join(vault, dir), { recursive: true });
      await fs.writeFile(path.join(vault, dir, 'example.html'), `<html><head><title>Orchid ${dir}</title></head><body>orchid</body></html>`);
    }
    const result = await fallbackSearch('orchid', 20, vault);
    expect(result.mode).toBe('fallback');
    expect(result.hits.map((hit) => hit.path).sort()).toEqual(['brain/example.html', 'logs/meetings/example.html', 'logs/reports/example.html', 'out/example.html']);
    expect(await fs.readdir(vault)).not.toContain('.robin');
  } finally { await fs.rm(vault, { recursive: true, force: true }); }
});
