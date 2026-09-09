import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateIndexes } from '../generate-brain-indexes.mjs';

test('derived navigation is dry-run by default, idempotent, and preserves overwritten history', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-navigation-'));
  try {
    await fs.mkdir(path.join(vault, 'brain/tasks/archive'), { recursive: true });
    const doc = (type, title, extra = '') => `<!doctype html><html><head><title>${title}</title><meta name="robin:type" content="${type}">${extra}</head><body><article data-robin-doc><p>Retain this original.</p></article></body></html>`;
    const original = doc('index', 'Old map');
    await fs.writeFile(path.join(vault, 'brain/_index.html'), original);
    await fs.writeFile(path.join(vault, 'brain/tasks/work.html'), doc('task', 'Work &amp; evidence', '<meta name="robin:status" content="open"><meta name="robin:priority" content="p1"><meta name="robin:next_action" content="Verify delivery">'));
    await fs.writeFile(path.join(vault, 'brain/tasks/archive/old.html'), doc('task', 'Archived obligation', '<meta name="robin:status" content="open">'));
    await fs.mkdir(path.join(vault, 'brain/tasks/archives'), { recursive: true });
    await fs.mkdir(path.join(vault, 'brain/tasks/archived'), { recursive: true });
    await fs.writeFile(path.join(vault, 'brain/tasks/archives/plural.html'), doc('task', 'Plural archive obligation', '<meta name="robin:status" content="open">'));
    await fs.writeFile(path.join(vault, 'brain/tasks/archived/past.html'), doc('task', 'Archived folder obligation', '<meta name="robin:status" content="open">'));
    await fs.mkdir(path.join(vault, 'brain/about_example'), { recursive: true });
    await fs.writeFile(path.join(vault, 'brain/about_example/_index.html'), doc('index', 'Personal context example'));
    const dry = await generateIndexes(vault);
    assert.ok(dry.includes('brain/thinking/_index.html'));
    assert.equal(await fs.readFile(path.join(vault, 'brain/_index.html'), 'utf8'), original);
    await generateIndexes(vault, { write: true });
    assert.match(await fs.readFile(path.join(vault, 'brain/_index.html'), 'utf8'), /about_example\/_index/);
    const tasks = await fs.readFile(path.join(vault, 'brain/tasks/_index.html'), 'utf8');
    assert.match(tasks, /Work &amp; evidence/);
    assert.match(tasks, /Verify delivery/);
    assert.doesNotMatch(tasks, /Archived obligation/);
    assert.doesNotMatch(tasks, /Plural archive obligation/);
    assert.doesNotMatch(tasks, /Archived folder obligation/);
    const eventFiles = await fs.readdir(path.join(vault, 'inbox/robin/edits'));
    const ledger = path.join(vault, 'inbox/robin/edits', eventFiles[0]);
    const before = await fs.readFile(ledger, 'utf8');
    const event = before.trim().split('\n').map(JSON.parse).find(e => e.page_path === 'brain/_index.html');
    assert.equal(await fs.readFile(path.join(vault, event.snapshot), 'utf8'), original);
    assert.deepEqual(await generateIndexes(vault, { write: true, now: new Date('2028-01-01T00:00:00Z') }), []);
    assert.equal(await fs.readFile(ledger, 'utf8'), before);
  } finally { await fs.rm(vault, { recursive: true, force: true }); }
});

test('explicit section navigation preserves records, omits archive directories and rejects unsafe targets', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-section-'));
  try {
    for (const dir of ['brain/projects/example', 'brain/projects/example/components', 'brain/projects/example/archives']) await fs.mkdir(path.join(vault, dir), { recursive: true });
    const doc = title => `<html><head><title>${title}</title></head><body><article data-robin-doc><p>Historical detail</p></article></body></html>`;
    for (const [rel, title] of [['_index.html', 'Example'], ['record.html', 'Canonical record'], ['components/_index.html', 'Components'], ['archives/_index.html', 'Archive directory']]) await fs.writeFile(path.join(vault, 'brain/projects/example', rel), doc(title));
    await generateIndexes(vault, { sections: ['brain/projects/example'], write: true });
    const index = await fs.readFile(path.join(vault, 'brain/projects/example/_index.html'), 'utf8');
    assert.match(index, /Canonical record/);
    assert.match(index, /Components/);
    assert.doesNotMatch(index, /Archive directory|Historical detail/);
    assert.equal(await fs.readFile(path.join(vault, 'brain/projects/example/record.html'), 'utf8'), doc('Canonical record'));
    assert.deepEqual(await generateIndexes(vault, { sections: ['brain/projects/example'], write: true }), []);
    await assert.rejects(generateIndexes(vault, { sections: ['brain/../inbox'], write: true }), /Section must/);
    await assert.rejects(generateIndexes(vault, { sections: ['brain/projects/missing'], write: true }), /must already exist/);
  } finally { await fs.rm(vault, { recursive: true, force: true }); }
});
