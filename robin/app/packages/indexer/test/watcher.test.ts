import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { openInMemoryDb } from "../src/db.js";
import { Watcher, type WatchEvent } from "../src/watcher.js";

process.env["ROBIN_EMBED_MODE"] = "stub";

function page(slug: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
  <title>${slug}</title>
  <meta name="robin:path" content="logs/meetings/${slug}.html">
  <meta name="robin:slug" content="${slug}">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-07-25T00:00:00Z">
</head><body><article data-robin-doc><p>${body}</p></article></body></html>`;
}

function waitForEvent(
  events: Array<{ event: WatchEvent; filePath: string }>,
  event: WatchEvent,
  filePath: string,
): Promise<void> {
  const seen = events.some((entry) => entry.event === event && entry.filePath === filePath);
  if (seen) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let poll: ReturnType<typeof setInterval>;
    const deadline = setTimeout(() => {
      clearInterval(poll);
      reject(
        new Error(
          `timed out waiting for ${event} ${filePath}; events=${JSON.stringify(events)}`,
        ),
      );
    }, 5_000);
    poll = setInterval(() => {
      if (events.some((entry) => entry.event === event && entry.filePath === filePath)) {
        clearTimeout(deadline);
        clearInterval(poll);
        resolve();
      }
    }, 25);
  });
}

describe("Watcher", () => {
  let vault: string;
  let db: ReturnType<typeof openInMemoryDb>;
  let watcher: Watcher;
  let previousPolling: string | undefined;

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-watcher-"));
    previousPolling = process.env["CHOKIDAR_USEPOLLING"];
    // macOS FSEvents can occasionally lose the first event immediately after
    // a ready crawl. Polling keeps this real-filesystem regression deterministic
    // while leaving production watcher behavior unchanged.
    process.env["CHOKIDAR_USEPOLLING"] = "1";
    for (const root of ["brain", "logs/meetings", "logs/reports", "out"]) {
      await fs.mkdir(path.join(vault, root), { recursive: true });
    }
    db = openInMemoryDb();
  });

  afterEach(async () => {
    await watcher?.close();
    db?.close();
    await fs.rm(vault, { recursive: true, force: true });
    if (previousPolling === undefined) delete process.env["CHOKIDAR_USEPOLLING"];
    else process.env["CHOKIDAR_USEPOLLING"] = previousPolling;
  });

  it("indexes meeting create/update/delete events after the watcher is ready", async () => {
    const events: Array<{ event: WatchEvent; filePath: string }> = [];
    watcher = new Watcher({
      vaultPath: vault,
      db,
      onEvent: (event, filePath) => events.push({ event, filePath }),
    });
    watcher.start();
    await watcher.ready();

    const relPath = "logs/meetings/live.html";
    const absolutePath = path.join(vault, relPath);
    const add = waitForEvent(events, "add", absolutePath);
    await fs.writeFile(absolutePath, page("live", "first body"));
    await add;
    expect(db.prepare("SELECT body_text FROM pages WHERE path = ?").get(relPath)).toMatchObject({
      body_text: "first body",
    });

    const change = waitForEvent(events, "change", absolutePath);
    await fs.writeFile(absolutePath, page("live", "updated body"));
    await change;
    expect(db.prepare("SELECT body_text FROM pages WHERE path = ?").get(relPath)).toMatchObject({
      body_text: "updated body",
    });

    const unlink = waitForEvent(events, "unlink", absolutePath);
    await fs.unlink(absolutePath);
    await unlink;
    expect(db.prepare("SELECT path FROM pages WHERE path = ?").get(relPath)).toBeUndefined();
  });
});
