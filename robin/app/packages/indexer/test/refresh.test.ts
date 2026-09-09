import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIndexer, type Indexer } from "../src/index.js";

process.env["ROBIN_EMBED_MODE"] = "stub";

function page(slug: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
  <title>${slug}</title>
  <meta name="robin:path" content="brain/${slug}.html">
  <meta name="robin:slug" content="${slug}">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-07-25T00:00:00Z">
</head><body><article data-robin-doc><p>${body}</p></article></body></html>`;
}

describe("Indexer.refresh()", () => {
  let vault: string;
  let indexer: Indexer;

  beforeEach(async () => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "robin-refresh-"));
    for (const root of ["brain", "logs/meetings", "logs/reports", "out"]) {
      fs.mkdirSync(path.join(vault, root), { recursive: true });
    }
    indexer = await createIndexer({ vaultPath: vault });
  });

  afterEach(() => {
    indexer.close();
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("upserts changed files and removes deleted paths without a full scan", async () => {
    const target = path.join(vault, "brain", "alpha.html");
    fs.writeFileSync(target, page("alpha", "first body"));

    const added = await indexer.refresh(["brain/alpha.html"]);
    expect(added).toMatchObject({ indexed: 1, removed: 0, skipped: 0, errors: [] });
    expect(
      indexer.db.prepare("SELECT body_text FROM pages WHERE path = ?").get("brain/alpha.html"),
    ).toMatchObject({ body_text: "first body" });

    fs.writeFileSync(target, page("alpha", "second body"));
    await indexer.refresh(["brain/alpha.html"]);
    expect(
      indexer.db.prepare("SELECT body_text FROM pages WHERE path = ?").get("brain/alpha.html"),
    ).toMatchObject({ body_text: "second body" });

    fs.unlinkSync(target);
    const removed = await indexer.refresh(["brain/alpha.html"]);
    expect(removed.removed).toBe(1);
    expect(
      indexer.db.prepare("SELECT path FROM pages WHERE path = ?").get("brain/alpha.html"),
    ).toBeUndefined();
  });

  it("skips non-canonical and escaping paths", async () => {
    const result = await indexer.refresh([
      "logs/daily.html",
      "../outside.html",
      "brain/not-html.md",
    ]);
    expect(result).toMatchObject({ indexed: 0, removed: 0, skipped: 3, errors: [] });
  });

  it("refreshes canonical meeting and report pages, but skips raw logs", async () => {
    fs.writeFileSync(path.join(vault, "logs/meetings/one.html"), page("one", "meeting body"));
    fs.writeFileSync(path.join(vault, "logs/reports/two.html"), page("two", "report body"));
    fs.writeFileSync(path.join(vault, "logs/meetings/raw.md"), "# transcript");

    const result = await indexer.refresh([
      "logs/meetings/one.html",
      "logs/reports/two.html",
      "logs/meetings/raw.md",
    ]);

    expect(result).toMatchObject({ indexed: 2, removed: 0, skipped: 1, errors: [] });
    expect(indexer.db.prepare("SELECT path FROM pages ORDER BY path").all()).toEqual([
      { path: "logs/meetings/one.html" },
      { path: "logs/reports/two.html" },
    ]);
  });
});
