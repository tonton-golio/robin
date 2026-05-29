/**
 * log-append.test.ts
 *
 * Tests the atomic log append:
 * - Entry is prepended (newest at top)
 * - Existing content is preserved
 * - Date header is injected if missing
 * - No tmp files left after successful write
 * - Works on empty file
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { appendLog } from '../src/html-utils.js';

function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-test-log-'));
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  return dir;
}

describe('appendLog', () => {
  let vault: string;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('creates the file and prepends entry when file does not exist', async () => {
    const bytes = await appendLog(vault, 'changelog', 'First entry');
    const content = fs.readFileSync(
      path.join(vault, 'logs', 'changelog.md'),
      'utf8'
    );
    expect(content).toContain('First entry');
    expect(bytes).toBeGreaterThan(0);
  });

  it('prepends to existing content (newest at top)', async () => {
    const changelogPath = path.join(vault, 'logs', 'changelog.md');
    fs.writeFileSync(changelogPath, '## [2026-01-01]\n\nOld entry\n');

    await appendLog(vault, 'changelog', '## [2026-05-26]\n\nNew entry');
    const content = fs.readFileSync(changelogPath, 'utf8');

    // New entry should come before old entry
    const newIdx = content.indexOf('New entry');
    const oldIdx = content.indexOf('Old entry');
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it('injects a date header if entry does not start with ## [', async () => {
    await appendLog(vault, 'changelog', 'No header here');
    const content = fs.readFileSync(
      path.join(vault, 'logs', 'changelog.md'),
      'utf8'
    );
    // Should have an injected header
    expect(content).toMatch(/^## \[\d{4}-\d{2}-\d{2}\]/);
    expect(content).toContain('No header here');
  });

  it('does NOT inject header if entry already starts with ## [', async () => {
    await appendLog(vault, 'changelog', '## [2026-05-26]\n\nAlready has header');
    const content = fs.readFileSync(
      path.join(vault, 'logs', 'changelog.md'),
      'utf8'
    );
    // Should not have double header
    const headerCount = (content.match(/^## \[/gm) ?? []).length;
    expect(headerCount).toBe(1);
  });

  it('leaves no .tmp files after successful write', async () => {
    await appendLog(vault, 'changelog', 'Clean write test');
    const logsDir = path.join(vault, 'logs');
    const files = fs.readdirSync(logsDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp-'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('works for ingest log file', async () => {
    const bytes = await appendLog(vault, 'ingest', '## [2026-05-26]\n\nIngested foo.md');
    const content = fs.readFileSync(
      path.join(vault, 'logs', 'ingest-log.md'),
      'utf8'
    );
    expect(content).toContain('Ingested foo.md');
    expect(bytes).toBeGreaterThan(0);
  });

  it('does not lose entries under concurrent appends', async () => {
    // Previously a read-modify-write race meant concurrent appends could clobber
    // each other; appendLog now serializes them.
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, (_, i) => appendLog(vault, 'changelog', `## [2026-05-26]\n\nConcurrent entry ${i}`)),
    );
    const content = fs.readFileSync(path.join(vault, 'logs', 'changelog.md'), 'utf8');
    for (let i = 0; i < N; i++) {
      expect(content).toContain(`Concurrent entry ${i}`);
    }
    // And no temp files left behind.
    expect(fs.readdirSync(path.join(vault, 'logs')).filter((f) => f.includes('.tmp-'))).toHaveLength(0);
  });

  it('accumulates multiple entries correctly', async () => {
    await appendLog(vault, 'changelog', '## [2026-05-24]\n\nEntry 1');
    await appendLog(vault, 'changelog', '## [2026-05-25]\n\nEntry 2');
    await appendLog(vault, 'changelog', '## [2026-05-26]\n\nEntry 3');

    const content = fs.readFileSync(
      path.join(vault, 'logs', 'changelog.md'),
      'utf8'
    );
    const idx1 = content.indexOf('Entry 1');
    const idx2 = content.indexOf('Entry 2');
    const idx3 = content.indexOf('Entry 3');
    // Entries should be in reverse order (newest first)
    expect(idx3).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx1);
  });
});
