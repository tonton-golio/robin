/**
 * integration.test.ts
 *
 * Spawns the MCP server via StdioClientTransport and calls ≥4 tools
 * against the fixture vault at tests/fixtures/vault/
 *
 * Tools exercised:
 *   1. page.read   — read risk-register from fixture vault
 *   2. page.list   — list tasks in fixture vault
 *   3. vault.stats — aggregate stats
 *   4. page.search — fallback mode (no indexer in fixture vault)
 *   5. vault.lint  — structural lint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as url from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const FIXTURE_VAULT = path.resolve(
  __dirname,
  '../../../tests/fixtures/vault'
);

const CLI_PATH = path.resolve(__dirname, '../dist/cli.js');

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: [CLI_PATH, '--vault', FIXTURE_VAULT],
    stderr: 'pipe',
  });

  client = new Client({ name: 'robin-test', version: '0.0.1' });
  await client.connect(transport);
}, 30000);

afterAll(async () => {
  await client.close().catch(() => {});
});

// ── helpers ────────────────────────────────────────────────────────────────

function parseResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('No text content in result');
  return JSON.parse(text);
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('MCP integration — fixture vault', () => {
  it('tool 1: page.read — reads risk-register by path', async () => {
    const result = await client.callTool({
      name: 'page.read',
      arguments: { ref: 'brain/risk-register.html' },
    });

    const data = parseResult(result as { content: Array<{ type: string; text?: string }> }) as {
      path: string;
      slug: string;
      meta: { type: string };
      blocks: unknown[] | null;
      body_html: string;
    };

    expect(data.path).toBe('brain/risk-register.html');
    expect(data.slug).toBe('risk-register');
    expect(data.meta.type).toBe('knowledge');
    // v0.2: blocks payload is no longer embedded; body_html is the source of truth.
    expect(data.blocks).toBeNull();
    // body_html is the inner content of article[data-robin-doc] (not the wrapper)
    expect(data.body_html).toContain('data-block');
  });

  it('tool 2: page.list — lists task-type pages', async () => {
    const result = await client.callTool({
      name: 'page.list',
      arguments: { type: 'task' },
    });

    const data = parseResult(result as { content: Array<{ type: string; text?: string }> }) as {
      items: Array<{ slug: string; type: string }>;
    };

    expect(Array.isArray(data.items)).toBe(true);
    // Fixture has sample-task.html which is type=task
    const taskSlugs = data.items.map((i) => i.slug);
    expect(taskSlugs).toContain('sample-task');
    for (const item of data.items) {
      expect(item.type).toBe('task');
    }
  });

  it('tool 3: vault.stats — returns page counts', async () => {
    const result = await client.callTool({
      name: 'vault.stats',
      arguments: {},
    });

    const data = parseResult(result as { content: Array<{ type: string; text?: string }> }) as {
      pages: number;
      by_type: Record<string, number>;
      links: number;
    };

    expect(data.pages).toBeGreaterThan(0);
    expect(typeof data.by_type).toBe('object');
    expect(typeof data.links).toBe('number');
  });

  it('tool 4: page.search — returns fallback mode when indexer unavailable', async () => {
    const result = await client.callTool({
      name: 'page.search',
      arguments: { query: 'risk' },
    });

    const data = parseResult(result as { content: Array<{ type: string; text?: string }> }) as {
      hits: unknown[];
      mode: string;
    };

    // Without a real indexer the server falls back gracefully
    expect(['rrf', 'fallback']).toContain(data.mode);
    expect(Array.isArray(data.hits)).toBe(true);
  });

  it('tool 5: vault.lint — returns issues array (no crash)', async () => {
    const result = await client.callTool({
      name: 'vault.lint',
      arguments: { check: ['frontmatter', 'links'] },
    });

    const data = parseResult(result as { content: Array<{ type: string; text?: string }> }) as {
      issues: Array<{ path: string; check: string; severity: string; message: string }>;
    };

    expect(Array.isArray(data.issues)).toBe(true);
    // Each issue must have the required shape
    for (const issue of data.issues) {
      expect(typeof issue.path).toBe('string');
      expect(typeof issue.check).toBe('string');
      expect(typeof issue.severity).toBe('string');
      expect(typeof issue.message).toBe('string');
    }
  });

  it('tool 6: page.read — resolves by slug (unique)', async () => {
    const result = await client.callTool({
      name: 'page.read',
      arguments: { ref: 'sample-task' },
    });

    const data = parseResult(result as { content: Array<{ type: string; text?: string }> }) as {
      slug: string;
      meta: { type: string; priority: string };
    };

    expect(data.slug).toBe('sample-task');
    expect(data.meta.type).toBe('task');
    expect(data.meta.priority).toBe('p2');
  });
});
