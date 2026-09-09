import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  deleteWithHistory,
  listPendingMutations,
  moveWithHistory,
  recoverPendingMutations,
} from "../src/index.js";
import type { EditEvent } from "../src/index.js";

async function readEvents(vault: string): Promise<EditEvent[]> {
  const directory = path.join(vault, "inbox", "robin", "edits");
  const files = await fs.readdir(directory).catch(() => []);
  const events: EditEvent[] = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(directory, file), "utf8");
    for (const line of raw.split("\n")) {
      if (line.trim()) events.push(JSON.parse(line) as EditEvent);
    }
  }
  return events;
}

describe("page lifecycle transactions", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-lifecycle-"));
    await fs.mkdir(path.join(vault, "brain"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
  });

  it("moves a page, rewrites robin:path, and records one edit.moved event", async () => {
    const source = path.join(vault, "brain", "source.html");
    const destination = path.join(vault, "brain", "archive", "source.html");
    const html = `<!doctype html>
<html><head>
  <title>Source</title>
  <meta name="robin:path" content="brain/source.html">
</head><body><article data-robin-doc><h1>Source</h1></article></body></html>`;
    await fs.writeFile(source, html, "utf8");

    const result = await moveWithHistory({
      vaultRoot: vault,
      fromAbsolutePath: source,
      toAbsolutePath: destination,
      origin: "mcp",
      tool: "page.delete",
    });

    expect(result.moved).toBe(true);
    await expect(fs.access(source)).rejects.toThrow();
    expect(await fs.readFile(destination, "utf8")).toContain('content="brain/archive/source.html"');
    expect(result.event).toMatchObject({
      event: "edit.moved",
      previous_path: "brain/source.html",
      page_path: "brain/archive/source.html",
      transaction_id: result.event?.id,
    });
    expect(result.event?.snapshot).toContain(".history/brain/source.html/");
    expect(await listPendingMutations(vault)).toEqual([]);
  });

  it("refuses to overwrite an occupied move destination", async () => {
    const source = path.join(vault, "brain", "source.html");
    const destination = path.join(vault, "brain", "destination.html");
    await fs.writeFile(source, "<head></head><p>source</p>", "utf8");
    await fs.writeFile(destination, "<head></head><p>destination</p>", "utf8");

    await expect(
      moveWithHistory({
        vaultRoot: vault,
        fromAbsolutePath: source,
        toAbsolutePath: destination,
      }),
    ).rejects.toThrow(/vault_destination_exists/);
    expect(await fs.readFile(source, "utf8")).toContain("source");
    expect(await fs.readFile(destination, "utf8")).toContain("destination");
  });

  it("rewrites a single-quoted, content-before-name robin:path structurally", async () => {
    const source = path.join(vault, "brain", "source.html");
    const destination = path.join(vault, "brain", "moved.html");
    await fs.writeFile(
      source,
      "<!doctype html><html><head><meta content='brain/source.html' name='robin:path'>" +
        '<meta content="0.2" name="robin:version"></head>' +
        "<body><article data-robin-doc></article></body></html>",
      "utf8",
    );

    await moveWithHistory({
      vaultRoot: vault,
      fromAbsolutePath: source,
      toAbsolutePath: destination,
    });
    const moved = await fs.readFile(destination, "utf8");
    expect(moved.match(/name=["']robin:path["']/g)).toHaveLength(1);
    expect(moved).toContain('name="robin:path" content="brain/moved.html"');
  });

  it("permanently deletes with a prior snapshot and edit.deleted event", async () => {
    const target = path.join(vault, "brain", "delete-me.html");
    await fs.writeFile(target, "<title>Delete me</title>", "utf8");

    const result = await deleteWithHistory({
      vaultRoot: vault,
      absolutePath: target,
      origin: "mcp",
      tool: "page.delete",
    });

    expect(result.deleted).toBe(true);
    await expect(fs.access(target)).rejects.toThrow();
    expect(result.event.event).toBe("edit.deleted");
    expect(result.event.after_hash).toBeNull();
    expect(await fs.readFile(path.join(vault, result.event.snapshot!), "utf8")).toBe(
      "<title>Delete me</title>",
    );
    const events = await readEvents(vault);
    expect(events.some((event) => event.id === result.event.id)).toBe(true);
    expect(await listPendingMutations(vault)).toEqual([]);
  });

  it("recovers a committed delete only from its durable tombstone", async () => {
    const target = path.join(vault, "brain", "delete-after-crash.html");
    await fs.writeFile(target, "<title>Delete after crash</title>", "utf8");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "robin-delete-events-"));
    const edits = path.join(vault, "inbox", "robin", "edits");
    await fs.mkdir(path.dirname(edits), { recursive: true });
    await fs.symlink(outside, edits, "dir");

    try {
      await expect(
        deleteWithHistory({
          vaultRoot: vault,
          absolutePath: target,
          origin: "mcp",
          tool: "page.delete",
        }),
      ).rejects.toThrow(/vault_path_symlink|vault_path_escape/);
      await expect(fs.access(target)).rejects.toThrow();
      const [pending] = await listPendingMutations(vault);
      expect(pending?.receipt?.tombstone_path).toBeTruthy();
      await expect(
        fs.access(path.join(vault, ...pending!.receipt!.tombstone_path!.split("/"))),
      ).resolves.toBeUndefined();

      await fs.unlink(edits);
      expect(await recoverPendingMutations(vault)).toMatchObject([{ status: "ready" }]);
      expect(await recoverPendingMutations(vault, { repair: true })).toMatchObject([
        { status: "recovered" },
      ]);
      expect(await listPendingMutations(vault)).toEqual([]);
      await expect(
        fs.access(path.join(vault, ...pending!.receipt!.tombstone_path!.split("/"))),
      ).rejects.toThrow();
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
