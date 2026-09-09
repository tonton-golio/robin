import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const doctor = path.join(repoRoot, 'robin/scripts/doctor.sh');

function section(output, heading) {
  const start = output.indexOf(heading);
  assert.notEqual(start, -1, `missing doctor section: ${heading}`);
  const end = output.indexOf('\n==>', start + heading.length);
  return output.slice(start, end === -1 ? output.length : end);
}

function runDoctor(repoRoot, doctor, vault) {
  return spawnSync('bash', [doctor, '--report'], {
    cwd: repoRoot,
    env: { ...process.env, ROBIN_VAULT: vault },
    encoding: 'utf8',
  });
}

test('doctor permits durable PPTX exports and nested daily/remsleep archive duplicates', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-doctor-'));
  try {
    await fs.mkdir(path.join(vault, 'brain'), { recursive: true });
    await fs.mkdir(path.join(vault, 'logs/daily/archive/2026-05'), { recursive: true });
    await fs.mkdir(path.join(vault, 'logs/remsleep/archive/2026-05'), { recursive: true });
    await fs.mkdir(path.join(vault, 'out/presentations'), { recursive: true });
    const html = '<!doctype html><html><head><title>Daily</title></head><body><article data-robin-doc /></body></html>';
    await fs.writeFile(path.join(vault, 'logs/daily/2026-05-27.html'), html);
    await fs.writeFile(path.join(vault, 'logs/daily/archive/2026-05/2026-05-27.html'), html);
    await fs.writeFile(path.join(vault, 'logs/remsleep/archive/2026-05/2026-05-27.html'), html);
    await fs.writeFile(path.join(vault, 'out/presentations/deck.pptx'), 'fixture');
    await fs.mkdir(path.join(vault, 'inbox/archived/legacy-root'), { recursive: true });
    await fs.writeFile(
      path.join(vault, 'inbox/archived/legacy-root/source.md'),
      'Historical example: `artifacts/_shared.py:32-49`\n',
    );

    const result = runDoctor(repoRoot, doctor, vault);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.doesNotMatch(output, /ambiguous slug '2026-05-27'/);
    assert.match(section(output, '==> [ERROR] out is html + assets only'), /^ok$/m);
    assert.match(section(output, '==> [ERROR] no leaked/stale paths'), /^ok$/m);

    // Current inbox material remains part of the control-plane scan. This
    // guards against making the archive exemption a blanket inbox exemption.
    await fs.writeFile(path.join(vault, 'inbox/current.md'), '`artifacts/_shared.py:32-49`\n');
    const currentResult = runDoctor(repoRoot, doctor, vault);
    const currentOutput = `${currentResult.stdout}\n${currentResult.stderr}`;
    assert.equal(currentResult.status, 0, currentOutput);
    assert.match(section(currentOutput, '==> [ERROR] no leaked/stale paths'), /artifacts\/_shared\.py/);
  } finally {
    await fs.rm(vault, { recursive: true, force: true });
  }
});
