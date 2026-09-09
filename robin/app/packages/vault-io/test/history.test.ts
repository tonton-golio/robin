import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  writeWithHistory,
  recordEdit,
  pruneHistory,
  toVaultRelative,
  hashHtml,
} from "../src/index.js";
import type { EditEvent } from "../src/index.js";

async function readJsonl(file: string): Promise<EditEvent[]> {
  const raw = await fs.readFile(file, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EditEvent);
}

describe("history (recordEdit / writeWithHistory)", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-history-"));
  });
  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
  });

  it("writeWithHistory snapshots prior bytes + appends an edit event on an edit", async () => {
    const abs = path.join(vault, "brain", "foo.html");
    await writeWithHistory({
      absolutePath: abs,
      html: "<p>v1</p>",
      origin: "web",
      vaultRoot: vault,
    });
    const res = await writeWithHistory({
      absolutePath: abs,
      html: "<p>v2</p>",
      origin: "web",
      vaultRoot: vault,
    });

    // The on-disk page is the new version.
    expect(await fs.readFile(abs, "utf8")).toBe("<p>v2</p>");

    // The event was recorded with both hashes + a snapshot pointer.
    expect(res.event).toBeTruthy();
    expect(res.event!.event).toBe("edit.saved");
    expect(res.event!.page_path).toBe("brain/foo.html");
    expect(res.event!.before_hash).toBe(hashHtml("<p>v1</p>"));
    expect(res.event!.after_hash).toBe(hashHtml("<p>v2</p>"));
    expect(res.event!.origin).toBe("web");
    expect(res.event!.snapshot).toBeTruthy();

    // The snapshot holds the PRIOR bytes, and its filename hash matches them.
    const snapAbs = path.join(vault, res.event!.snapshot!);
    expect(await fs.readFile(snapAbs, "utf8")).toBe("<p>v1</p>");
    expect(res.event!.snapshot).toContain(hashHtml("<p>v1</p>").slice(0, 12));

    // The event landed in the month bucket.
    const month = res.event!.ts.slice(0, 7);
    const events = await readJsonl(path.join(vault, "inbox", "robin", "edits", `${month}.jsonl`));
    expect(events.map((e) => e.id)).toContain(res.event!.id);
  });

  it("stamps schema v2 fields (schema_version, kind, title, diff_stat) on a write", async () => {
    const abs = path.join(vault, "out", "presentations", "deck.html");
    await writeWithHistory({
      absolutePath: abs,
      html: "<title>V1</title>\n<p>a</p>\n",
      origin: "web",
      vaultRoot: vault,
    });
    const res = await writeWithHistory({
      absolutePath: abs,
      html: "<title>V2 &amp; more</title>\n<p>a</p>\n<p>b</p>\n",
      origin: "web",
      vaultRoot: vault,
    });

    expect(res.event!.schema_version).toBe(2);
    expect(res.event!.kind).toBe("deck");
    expect(res.event!.title).toBe("V2 & more");
    // One title line changed, one <p> line added → +2 / -1.
    expect(res.event!.diff_stat).toEqual({ added: 2, removed: 1 });
  });

  it("a create records diff_stat against empty (all lines added) and schema v2", async () => {
    const event = await recordEdit({
      vaultRoot: vault,
      absolutePath: path.join(vault, "brain", "tasks", "new.html"),
      priorBytes: null,
      newBytes: "<title>T</title>\n<p>x</p>\n",
      beforeHash: null,
      afterHash: hashHtml("<title>T</title>\n<p>x</p>\n"),
      origin: "mcp",
    });
    expect(event!.schema_version).toBe(2);
    expect(event!.kind).toBe("task");
    expect(event!.title).toBe("T");
    expect(event!.diff_stat).toEqual({ added: 2, removed: 0 });
  });

  it("a create has no snapshot and is tagged edit.created", async () => {
    const event = await recordEdit({
      vaultRoot: vault,
      absolutePath: path.join(vault, "brain", "new.html"),
      priorBytes: null,
      beforeHash: null,
      afterHash: hashHtml("<p>x</p>"),
      origin: "mcp",
      tool: "page.create",
    });
    expect(event!.event).toBe("edit.created");
    expect(event!.before_hash).toBeNull();
    expect(event!.snapshot).toBeUndefined();
    expect(event!.tool).toBe("page.create");
  });

  it("never logs edits to the edit-log substrate itself", async () => {
    const inEdits = await recordEdit({
      vaultRoot: vault,
      absolutePath: path.join(vault, "inbox", "robin", "edits", "2026-06.jsonl"),
      priorBytes: "old",
      beforeHash: hashHtml("old"),
      afterHash: hashHtml("new"),
    });
    const inHistory = await recordEdit({
      vaultRoot: vault,
      absolutePath: path.join(vault, ".history", "brain", "foo.html", "s.html"),
      priorBytes: "old",
      beforeHash: hashHtml("old"),
      afterHash: hashHtml("new"),
    });
    expect(inEdits).toBeNull();
    expect(inHistory).toBeNull();
  });

  it("does not record history when vaultRoot is omitted (Phase 0 behavior)", async () => {
    const abs = path.join(vault, "brain", "noroot.html");
    await writeWithHistory({ absolutePath: abs, html: "<p>a</p>" });
    const res = await writeWithHistory({ absolutePath: abs, html: "<p>b</p>" });
    expect(res.written).toBe(true);
    expect(res.event).toBeNull();
    await expect(fs.access(path.join(vault, ".history"))).rejects.toThrow();
  });

  it("toVaultRelative yields a POSIX vault-relative path", () => {
    expect(toVaultRelative("/v", "/v/brain/foo.html")).toBe("brain/foo.html");
  });
});

describe("symlink write-escape guard (F1)", () => {
  let vault: string;
  let outside: string;

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-guard-vault-"));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "robin-guard-outside-"));
  });
  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("refuses a write whose parent dir is a symlink pointing outside the vault", async () => {
    // brain/escape -> <outside>. A write under brain/escape/ would land outside.
    await fs.mkdir(path.join(vault, "brain"), { recursive: true });
    await fs.symlink(outside, path.join(vault, "brain", "escape"), "dir");

    const target = path.join(vault, "brain", "escape", "pwn.html");
    await expect(
      writeWithHistory({ absolutePath: target, html: "<p>x</p>", origin: "web", vaultRoot: vault }),
    ).rejects.toThrow(/vault_path_(?:escape|symlink)/);

    // Nothing was written through the symlink.
    await expect(fs.access(path.join(outside, "pwn.html"))).rejects.toThrow();
  });

  it("allows a normal contained write (guard is a no-op inside the vault)", async () => {
    const target = path.join(vault, "brain", "ok", "page.html");
    const res = await writeWithHistory({
      absolutePath: target,
      html: "<p>ok</p>",
      origin: "web",
      vaultRoot: vault,
    });
    expect(res.written).toBe(true);
    expect(await fs.readFile(target, "utf8")).toBe("<p>ok</p>");
  });

  it("does not enforce containment when vaultRoot is absent (raw internal write)", async () => {
    await fs.mkdir(path.join(vault, "brain"), { recursive: true });
    await fs.symlink(outside, path.join(vault, "brain", "escape"), "dir");
    const target = path.join(vault, "brain", "escape", "raw.html");
    // No vaultRoot → no history, no containment (unchanged Phase 0 behavior).
    const res = await writeWithHistory({ absolutePath: target, html: "<p>raw</p>" });
    expect(res.written).toBe(true);
    expect(await fs.readFile(path.join(outside, "raw.html"), "utf8")).toBe("<p>raw</p>");
  });
});

describe("pruneHistory retention", () => {
  let vault: string;
  const NOW = new Date("2026-06-03T12:00:00Z");

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-prune-"));
  });
  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
  });

  // Create a snapshot file whose filename encodes the given ISO timestamp.
  async function snap(iso: string): Promise<string> {
    const stamp = iso.replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
    const dir = path.join(vault, ".history", "brain", "foo.html");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${stamp}__abcdef012345.html`);
    await fs.writeFile(file, "<p>snap</p>", "utf8");
    return file;
  }

  it("keeps all recent, thins to 1/day in the mid window, 1/week beyond", async () => {
    // Recent (< 30d): both kept.
    await snap("2026-05-30T09:00:00Z");
    await snap("2026-05-30T18:00:00Z");
    // Mid window (30–90d): two on the same day → keep newest only.
    await snap("2026-04-10T08:00:00Z");
    const midNewest = await snap("2026-04-10T20:00:00Z");
    // Old (> 90d): two in the same week → keep newest only.
    await snap("2026-01-05T08:00:00Z");
    const oldNewest = await snap("2026-01-06T08:00:00Z");

    const dry = await pruneHistory(vault, { now: NOW, dryRun: true });
    expect(dry.scanned).toBe(6);
    expect(dry.deleted).toBe(2);
    expect(dry.kept).toBe(4);

    const res = await pruneHistory(vault, { now: NOW });
    expect(res.deleted).toBe(2);

    // The newest in each thinned bucket survives.
    await expect(fs.access(midNewest)).resolves.toBeUndefined();
    await expect(fs.access(oldNewest)).resolves.toBeUndefined();
    // Recent snapshots all survive.
    const recentDir = path.join(vault, ".history", "brain", "foo.html");
    const remaining = (await fs.readdir(recentDir)).filter((f) => f.startsWith("2026-05-30"));
    expect(remaining).toHaveLength(2);
  });

  it("never silently prunes a snapshot referenced by an edit event", async () => {
    const referenced = await snap("2026-01-05T08:00:00Z");
    await snap("2026-01-06T08:00:00Z");
    const relative = toVaultRelative(vault, referenced);
    const editsDir = path.join(vault, "inbox", "robin", "edits");
    await fs.mkdir(editsDir, { recursive: true });
    await fs.writeFile(
      path.join(editsDir, "2026-01.jsonl"),
      `${JSON.stringify({ id: "keep-snapshot", snapshot: relative })}\n`,
      "utf8",
    );

    const result = await pruneHistory(vault, { now: NOW });
    expect(result.preservedReferenced).toBe(1);
    await expect(fs.access(referenced)).resolves.toBeUndefined();
  });

  it("never prunes a snapshot referenced only by a pending mutation receipt", async () => {
    const target = path.join(vault, "brain", "pending.html");
    await writeWithHistory({
      absolutePath: target,
      html: "<p>before</p>",
      vaultRoot: vault,
    });
    const edits = path.join(vault, "inbox", "robin", "edits");
    await fs.rm(edits, { recursive: true, force: true });
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "robin-prune-events-"));
    await fs.symlink(outside, edits, "dir");
    try {
      await expect(
        writeWithHistory({
          absolutePath: target,
          html: "<p>after</p>",
          vaultRoot: vault,
        }),
      ).rejects.toThrow(/vault_path_symlink|vault_path_escape/);
      await fs.unlink(edits);

      const result = await pruneHistory(vault, {
        now: new Date("2028-06-03T12:00:00Z"),
      });
      expect(result.preservedReferenced).toBe(1);
      const snapshots = result.deletedPaths.filter((item) => item.includes("pending.html"));
      expect(snapshots).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("fails closed when the history tree contains a symlink", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "robin-prune-outside-"));
    const history = path.join(vault, ".history");
    await fs.mkdir(history, { recursive: true });
    await fs.symlink(outside, path.join(history, "aliased"), "dir");
    try {
      await expect(pruneHistory(vault, { now: NOW })).rejects.toThrow(
        /history_prune_blocked_by_symlink/,
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
