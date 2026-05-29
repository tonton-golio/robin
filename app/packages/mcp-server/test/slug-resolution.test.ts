/**
 * slug-resolution.test.ts
 *
 * Tests the resolveRef() function:
 * - slug → path resolves correctly from filesystem
 * - ambiguous slug returns error with candidates
 * - path ref (ends in .html) resolves directly
 * - not-found slug returns error
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveRef } from '../src/resolve.js';
import type { ToolContext } from '../src/types.js';

function makeFixtureVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-test-slug-'));
  const brain = path.join(dir, 'brain');
  fs.mkdirSync(brain, { recursive: true });

  const riskHtml = `<!doctype html><html><head>
    <meta name="robin:slug" content="risk-register">
    <meta name="robin:type" content="knowledge">
    <meta name="robin:path" content="brain/risk-register.html">
    <meta name="robin:updated" content="2026-05-26T00:00:00Z">
  </head><body><article data-robin-doc></article></body></html>`;
  fs.writeFileSync(path.join(brain, 'risk-register.html'), riskHtml);

  // Duplicate slug under brain/tasks for ambiguity test
  const tasks = path.join(dir, 'brain', 'tasks');
  fs.mkdirSync(tasks, { recursive: true });
  const ambigHtml = `<!doctype html><html><head>
    <meta name="robin:slug" content="ambiguous-slug">
    <meta name="robin:type" content="task">
    <meta name="robin:path" content="brain/tasks/ambiguous-slug.html">
    <meta name="robin:updated" content="2026-05-26T00:00:00Z">
  </head><body><article data-robin-doc></article></body></html>`;
  fs.writeFileSync(path.join(tasks, 'ambiguous-slug.html'), ambigHtml);

  const projects = path.join(dir, 'brain', 'projects');
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(path.join(projects, 'ambiguous-slug.html'), ambigHtml);

  return dir;
}

function makeCtx(vaultPath: string): ToolContext {
  return { vaultPath, indexer: null };
}

describe('resolveRef — slug mode (filesystem fallback)', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = makeFixtureVault();
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it('resolves a unique slug to the correct path', async () => {
    const ctx = makeCtx(vaultPath);
    const result = await resolveRef('risk-register', ctx);
    expect(result.slug).toBe('risk-register');
    expect(result.vaultRelativePath).toBe('brain/risk-register.html');
    expect(result.absolutePath).toBe(path.join(vaultPath, 'brain/risk-register.html'));
  });

  it('throws with candidates for an ambiguous slug', async () => {
    const ctx = makeCtx(vaultPath);
    await expect(resolveRef('ambiguous-slug', ctx)).rejects.toMatchObject({
      code: -32602,
      data: expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.stringContaining('ambiguous-slug.html'),
          expect.stringContaining('ambiguous-slug.html'),
        ]),
      }),
    });
  });

  it('throws not_found for an unknown slug', async () => {
    const ctx = makeCtx(vaultPath);
    await expect(resolveRef('no-such-page', ctx)).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining('not found'),
    });
  });
});

describe('resolveRef — path mode', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = makeFixtureVault();
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it('resolves a vault-relative path directly', async () => {
    const ctx = makeCtx(vaultPath);
    const result = await resolveRef('brain/risk-register.html', ctx);
    expect(result.slug).toBe('risk-register');
    expect(result.vaultRelativePath).toBe('brain/risk-register.html');
  });

  it('throws for a non-existent path ref', async () => {
    const ctx = makeCtx(vaultPath);
    await expect(resolveRef('brain/ghost.html', ctx)).rejects.toMatchObject({
      code: -32602,
    });
  });
});

function makePathLikeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-test-pathlike-'));
  const write = (rel: string, slug: string) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(
      abs,
      `<!doctype html><html><head>
        <meta name="robin:slug" content="${slug}">
        <meta name="robin:type" content="knowledge">
        <meta name="robin:path" content="${rel}">
        <meta name="robin:updated" content="2026-05-26T00:00:00Z">
      </head><body><article data-robin-doc></article></body></html>`
    );
  };
  // A feature page moved under projects/beacon/features after the restructure.
  write('brain/projects/beacon/features/images.html', 'images');
  // Two _index pages that share the basename slug `_index`.
  write('brain/projects/_index.html', '_index');
  write('brain/people/_index.html', '_index');
  return dir;
}

describe('resolveRef — path-like refs (post-restructure wikilinks)', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = makePathLikeVault();
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it('resolves a path-like ref by path suffix even when the basename slug differs', async () => {
    const ctx = makeCtx(vaultPath);
    const result = await resolveRef('features/images', ctx);
    expect(result.vaultRelativePath).toBe('brain/projects/beacon/features/images.html');
    expect(result.slug).toBe('images');
  });

  it('disambiguates colliding _index basenames via the path prefix', async () => {
    const ctx = makeCtx(vaultPath);
    const result = await resolveRef('projects/_index', ctx);
    expect(result.vaultRelativePath).toBe('brain/projects/_index.html');
  });

  it('reports ambiguity for a bare slug shared by multiple pages', async () => {
    const ctx = makeCtx(vaultPath);
    await expect(resolveRef('_index', ctx)).rejects.toMatchObject({
      code: -32602,
      data: expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.stringContaining('_index.html'),
        ]),
      }),
    });
  });

  it('rejects a .html ref that escapes the vault', async () => {
    const ctx = makeCtx(vaultPath);
    await expect(resolveRef('../../../etc/passwd.html', ctx)).rejects.toMatchObject({ code: -32602 });
    await expect(resolveRef('brain/../../secret.html', ctx)).rejects.toMatchObject({ code: -32602 });
  });
});
