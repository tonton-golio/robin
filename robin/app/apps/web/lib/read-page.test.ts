import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSlugMap, resolveSlug } from './read-page';

describe('buildSlugMap archive preference', () => {
  let vault: string | undefined;

  afterEach(async () => {
    if (vault) await fs.rm(vault, { recursive: true, force: true });
  });

  it('resolves a bare basename to the current page while retaining explicit archive paths', async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-slug-map-'));
    await fs.mkdir(path.join(vault, 'brain/projects/archive'), { recursive: true });
    await fs.writeFile(path.join(vault, 'brain/projects/archive/roadmap.html'), '<html />');
    await fs.writeFile(path.join(vault, 'brain/projects/roadmap.html'), '<html />');

    const map = await buildSlugMap(vault);

    expect(resolveSlug(map, 'roadmap')).toBe('brain/projects/roadmap.html');
    expect(resolveSlug(map, 'projects/archive/roadmap')).toBe(
      'brain/projects/archive/roadmap.html',
    );
  });
});
