import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MEMORY_EVENTS_PATH,
  listMemories,
  loadMemoryProjection,
  resolveMemory,
  saveMemory,
  searchMemories,
} from '../src/index.js';

let vault: string;

beforeEach(async () => {
  vault = await fs.mkdtemp(path.join(os.tmpdir(), 'robin-memory-test-'));
});

afterEach(async () => {
  await fs.rm(vault, { recursive: true, force: true });
});

describe('@robin/memory', () => {
  it('saves searchable memories in an append-only event stream', async () => {
    const saved = await saveMemory(vault, {
      type: 'preference',
      tier: 'semantic',
      scope: 'brain/projects/robin/robin.html',
      subject: 'Robin knowledge search',
      summary: 'Robin should search promoted memory and repo pages together.',
      tags: ['robin', 'knowledge'],
      links: ['brain/projects/robin/robin.html'],
      source: { kind: 'manual', ref: 'test' },
      status: 'active',
      confidence: 'high',
    });

    const events = await fs.readFile(path.join(vault, MEMORY_EVENTS_PATH), 'utf8');
    expect(events.trim().split('\n')).toHaveLength(1);

    const hits = await searchMemories(vault, { query: 'knowledge pages', status: ['active'] });
    expect(hits[0]?.memory.id).toBe(saved.id);
    expect(hits[0]?.memory.tier).toBe('semantic');
    expect(hits[0]?.matched).toContain('summary');
  });

  it('merges exact duplicates with memory.seen instead of creating duplicate records', async () => {
    const first = await saveMemory(vault, {
      type: 'correction',
      subject: 'Annotation ingestion',
      summary: 'Reviewed comments should keep provenance.',
      source: { kind: 'annotation', ref: 'ann_one' },
    });

    const second = await saveMemory(vault, {
      type: 'correction',
      subject: 'Annotation ingestion',
      summary: 'Reviewed comments should keep provenance.',
      source: { kind: 'annotation', ref: 'ann_two' },
    });

    const memories = await listMemories(vault);
    const events = await loadMemoryProjection(vault);

    expect(second.id).toBe(first.id);
    expect(memories).toHaveLength(1);
    expect(memories[0]?.seen_count).toBe(2);
    expect(memories[0]?.source_count).toBe(2);
    expect(events.events.map((event) => event.event)).toEqual(['memory.saved', 'memory.seen']);
  });

  it('merges concurrent identical saves into one record (serialized read-modify-append)', async () => {
    // Two same-fingerprint saves fired without awaiting between them. Without
    // serialization both would read an empty projection and append a distinct
    // memory.saved, producing two records that should have collapsed into one.
    const [a, b] = await Promise.all([
      saveMemory(vault, {
        type: 'correction',
        subject: 'Concurrent dedup',
        summary: 'Two simultaneous saves must merge.',
        source: { kind: 'annotation', ref: 'race_one' },
      }),
      saveMemory(vault, {
        type: 'correction',
        subject: 'Concurrent dedup',
        summary: 'Two simultaneous saves must merge.',
        source: { kind: 'annotation', ref: 'race_two' },
      }),
    ]);

    expect(a.id).toBe(b.id);

    const memories = await listMemories(vault);
    expect(memories).toHaveLength(1);
    expect(memories[0]?.seen_count).toBe(2);
    expect(memories[0]?.source_count).toBe(2);

    const projection = await loadMemoryProjection(vault);
    expect(projection.events.map((event) => event.event)).toEqual(['memory.saved', 'memory.seen']);
  });

  it('resolves memories without mutating prior events', async () => {
    const saved = await saveMemory(vault, {
      type: 'task',
      subject: 'Review annotation queue',
      summary: 'Process open Robin comments.',
      source: { kind: 'manual', ref: 'test' },
    });

    const resolved = await resolveMemory(vault, {
      id: saved.id,
      status: 'archived',
      resolution: 'completed',
    });

    const projection = await loadMemoryProjection(vault);

    expect(resolved.status).toBe('archived');
    expect(projection.events.map((event) => event.event)).toEqual(['memory.saved', 'memory.resolved']);
    expect(projection.memories[0]?.status).toBe('archived');
    expect(projection.memories[0]?.resolution).toBe('completed');
  });

  it('defaults tiers from memory type for agentmemory-style consolidation', async () => {
    const saved = await saveMemory(vault, {
      type: 'procedure',
      subject: 'Release workflow',
      summary: 'Run tests before publishing release notes.',
      source: { kind: 'manual', ref: 'test' },
    });

    expect(saved.tier).toBe('procedural');

    const hits = await searchMemories(vault, { query: 'release', tier: ['procedural'] });
    expect(hits[0]?.memory.id).toBe(saved.id);
  });
});
