#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// A standalone framework checkout may not contain the private workspace hooks.
if (fs.existsSync(path.join(root, '.git')) && fs.existsSync(path.join(root, '.githooks/pre-commit')) && fs.existsSync(path.join(root, 'lefthook.yml'))) {
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let configured = '';
  try { configured = git(['config', '--get', 'core.hooksPath']); } catch { /* no override */ }
  if (configured && configured !== '.githooks') {
    console.log('Existing custom Git hooks retained. To use workspace gates, configure core.hooksPath=.githooks explicitly.');
  } else {
    for (const name of ['pre-commit', 'pre-push']) fs.chmodSync(path.join(root, '.githooks', name), 0o755);
    git(['config', '--local', 'core.hooksPath', '.githooks']);
    console.log('Workspace hooks installed from .githooks; checks use root lefthook.yml.');
  }
}
