import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertMarkdown } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goldenDir = path.join(__dirname, 'golden');

/**
 * Phase 1.5 — Round-trip golden test.
 *
 * For each `<name>.md` in test/golden/:
 *   1. Convert to HTML.
 *   2. Compare to checked-in `<name>.expected.html` (if present).
 *   3. Convert again — assert byte-equality (idempotent).
 *
 * To regenerate golden expectations:
 *   ROBIN_UPDATE_GOLDEN=1 npm run test:converter
 */
function listGolden(): string[] {
  if (!fs.existsSync(goldenDir)) return [];
  return fs
    .readdirSync(goldenDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

const updateMode = process.env.ROBIN_UPDATE_GOLDEN === '1';

describe('round-trip golden', () => {
  const files = listGolden();

  if (files.length === 0) {
    it('placeholder until golden files are added', () => {
      expect(true).toBe(true);
    });
    return;
  }

  for (const file of files) {
    const name = file.replace(/\.md$/, '');
    it(`${name} converts stably`, () => {
      const md = fs.readFileSync(path.join(goldenDir, file), 'utf8');
      const outputPath = `brain/${name}.html`;
      const updated = new Date('2026-05-26T00:00:00Z');

      const r1 = convertMarkdown(md, { outputPath, updated });
      const r2 = convertMarkdown(md, { outputPath, updated });
      expect(r1.html, 'second conversion should be byte-equal').toBe(r2.html);

      const expectedPath = path.join(goldenDir, `${name}.expected.html`);
      if (updateMode || !fs.existsSync(expectedPath)) {
        fs.writeFileSync(expectedPath, r1.html, 'utf8');
        return;
      }
      const expected = fs.readFileSync(expectedPath, 'utf8');
      expect(r1.html).toBe(expected);
    });
  }
});
