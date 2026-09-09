import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEMORY_EVENTS_PATH,
  listMemories,
  loadMemoryProjection,
  resolveMemory,
  saveMemory,
  searchMemories,
} from "../src/index.js";

let vault: string;

beforeEach(async () => {
  vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-memory-test-"));
});

afterEach(async () => {
  await fs.rm(vault, { recursive: true, force: true });
});

describe("@robin/memory", () => {
  it("saves searchable memories in an append-only event stream", async () => {
    const saved = await saveMemory(vault, {
      type: "preference",
      tier: "semantic",
      scope: "brain/projects/robin/robin.html",
      subject: "Robin knowledge search",
      summary: "Robin should search promoted memory and repo pages together.",
      tags: ["robin", "knowledge"],
      links: ["brain/projects/robin/robin.html"],
      source: { kind: "manual", ref: "test" },
      status: "active",
      confidence: "high",
    });

    const events = await fs.readFile(path.join(vault, MEMORY_EVENTS_PATH), "utf8");
    expect(events.trim().split("\n")).toHaveLength(1);

    const hits = await searchMemories(vault, { query: "knowledge pages", status: ["active"] });
    expect(hits[0]?.memory.id).toBe(saved.id);
    expect(hits[0]?.memory.tier).toBe("semantic");
    expect(hits[0]?.matched).toContain("summary");
  });

  it("merges exact duplicates with memory.seen instead of creating duplicate records", async () => {
    const first = await saveMemory(vault, {
      type: "correction",
      subject: "Annotation ingestion",
      summary: "Reviewed comments should keep provenance.",
      source: { kind: "annotation", ref: "ann_one" },
    });

    const second = await saveMemory(vault, {
      type: "correction",
      subject: "Annotation ingestion",
      summary: "Reviewed comments should keep provenance.",
      source: { kind: "annotation", ref: "ann_two" },
    });

    const memories = await listMemories(vault);
    const events = await loadMemoryProjection(vault);

    expect(second.id).toBe(first.id);
    expect(memories).toHaveLength(1);
    expect(memories[0]?.seen_count).toBe(2);
    expect(memories[0]?.source_count).toBe(2);
    expect(events.events.map((event) => event.event)).toEqual(["memory.saved", "memory.seen"]);
  });

  it("merges concurrent identical saves into one record (serialized read-modify-append)", async () => {
    // Two same-fingerprint saves fired without awaiting between them. Without
    // serialization both would read an empty projection and append a distinct
    // memory.saved, producing two records that should have collapsed into one.
    const [a, b] = await Promise.all([
      saveMemory(vault, {
        type: "correction",
        subject: "Concurrent dedup",
        summary: "Two simultaneous saves must merge.",
        source: { kind: "annotation", ref: "race_one" },
      }),
      saveMemory(vault, {
        type: "correction",
        subject: "Concurrent dedup",
        summary: "Two simultaneous saves must merge.",
        source: { kind: "annotation", ref: "race_two" },
      }),
    ]);

    expect(a.id).toBe(b.id);

    const memories = await listMemories(vault);
    expect(memories).toHaveLength(1);
    expect(memories[0]?.seen_count).toBe(2);
    expect(memories[0]?.source_count).toBe(2);

    const projection = await loadMemoryProjection(vault);
    expect(projection.events.map((event) => event.event)).toEqual(["memory.saved", "memory.seen"]);
  });

  it("resolves memories without mutating prior events", async () => {
    const saved = await saveMemory(vault, {
      type: "task",
      subject: "Review annotation queue",
      summary: "Process open Robin comments.",
      source: { kind: "manual", ref: "test" },
    });

    const resolved = await resolveMemory(vault, {
      id: saved.id,
      status: "archived",
      resolution: "completed",
    });

    const projection = await loadMemoryProjection(vault);

    expect(resolved.status).toBe("archived");
    expect(projection.events.map((event) => event.event)).toEqual([
      "memory.saved",
      "memory.resolved",
    ]);
    expect(projection.memories[0]?.status).toBe("archived");
    expect(projection.memories[0]?.resolution).toBe("completed");
  });

  it("defaults tiers from memory type for agentmemory-style consolidation", async () => {
    const saved = await saveMemory(vault, {
      type: "procedure",
      subject: "Release workflow",
      summary: "Run tests before publishing release notes.",
      source: { kind: "manual", ref: "test" },
    });

    expect(saved.tier).toBe("procedural");

    const hits = await searchMemories(vault, { query: "release", tier: ["procedural"] });
    expect(hits[0]?.memory.id).toBe(saved.id);
  });

  it("fails closed instead of appending past a malformed historical row", async () => {
    const target = path.join(vault, MEMORY_EVENTS_PATH);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '{"event":"memory.saved","memory":\n', "utf8");

    await expect(
      saveMemory(vault, {
        type: "preference",
        subject: "Do not compound corruption",
        summary: "Repair the ledger before another append.",
        source: { kind: "manual", ref: "test" },
      }),
    ).rejects.toThrow(/memory_integrity_error/);
    expect(await fs.readFile(target, "utf8")).toBe('{"event":"memory.saved","memory":\n');
  });

  it("replays legacy event rows instead of crashing on their missing fields", async () => {
    // The shape 28 rows of the real ledger are written in: a single `text`
    // blob, a singular `source`, `created` instead of the three timestamps,
    // an out-of-vocabulary `type`, and no supersedes/links/counts at all.
    const target = path.join(vault, MEMORY_EVENTS_PATH);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      `${JSON.stringify({
        event: "memory.saved",
        memory: {
          id: "mem_legacy_1",
          type: "fact",
          tier: "semantic",
          status: "active",
          confidence: "medium",
          scope: "project:demo",
          text: "The demo project uses the documented example schema.",
          tags: ["demo", "editorial"],
          source: { kind: "meeting", ref: "logs/meetings/x", captured_at: "2026-08-06T09:00:00Z" },
          created: "2026-08-06T09:00:00Z",
        },
      })}\n`,
      "utf8",
    );

    const projection = await loadMemoryProjection(vault);
    expect(projection.malformed).toHaveLength(0);
    const [legacy] = projection.memories;
    expect(legacy?.id).toBe("mem_legacy_1");
    expect(legacy?.type).toBe("other"); // "fact" is not in the vocabulary
    expect(legacy?.summary).toContain("documented example schema");
    expect(legacy?.subject).toBeTruthy();
    expect(legacy?.supersedes).toEqual([]);
    expect(legacy?.links).toEqual([]);
    expect(legacy?.sources).toHaveLength(1);
    expect(legacy?.updated_at).toBe("2026-08-06T09:00:00Z");
    expect(legacy?.fingerprint).toBeTruthy();

    // Searching and saving both replay the projection, so both used to throw.
    const hits = await searchMemories(vault, { query: "documented example schema" });
    expect(hits[0]?.memory.id).toBe("mem_legacy_1");

    const saved = await saveMemory(vault, {
      type: "decision",
      subject: "Append past legacy rows",
      summary: "A legacy row must not block new writes.",
      source: { kind: "manual", ref: "test" },
    });
    expect(saved.id).toBeTruthy();
    expect((await listMemories(vault)).map((memory) => memory.id)).toContain("mem_legacy_1");
  });

  it("still applies supersedes when replaying saved events", async () => {
    const first = await saveMemory(vault, {
      type: "decision",
      subject: "Old call",
      summary: "The superseded position.",
      source: { kind: "manual", ref: "test" },
    });
    const second = await saveMemory(vault, {
      type: "decision",
      subject: "New call",
      summary: "The replacement position.",
      source: { kind: "manual", ref: "test" },
      supersedes: [first.id],
    });

    const projection = await loadMemoryProjection(vault);
    const old = projection.memories.find((memory) => memory.id === first.id);
    expect(old?.status).toBe("superseded");
    expect(old?.superseded_by).toBe(second.id);
  });

  it("rejects empty normalized content before touching the ledger", async () => {
    await expect(
      saveMemory(vault, {
        type: "preference",
        subject: "   ",
        summary: "valid summary",
        source: { kind: "manual", ref: "test" },
      }),
    ).rejects.toThrow(/subject is required/);
    await expect(fs.access(path.join(vault, MEMORY_EVENTS_PATH))).rejects.toThrow();
  });
});
