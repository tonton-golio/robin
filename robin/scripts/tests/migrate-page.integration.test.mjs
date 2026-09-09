import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertBuiltRuntimeFresh, runMigration } from "../migrate-page.mjs";

const ARTICLE = `<article data-robin-doc>
    <h1>Migration fixture</h1>
    <p>Canonical body bytes must not change.</p>
  </article>`;

function page(overrides = "") {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Migration fixture</title>
  <meta name="robin:path" content="brain/page.html">
  <meta name="robin:slug" content="page">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-07-26T10:00:00Z">
  <meta name="robin:version" content="0.2">
  <meta name="robin:source" content="slack">
  ${overrides}
</head>
<body>
  ${ARTICLE}
</body>
</html>
`;
}

async function filesBelow(root) {
  const found = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) found.push(absolute);
    }
  }
  await walk(root);
  return found.sort();
}

test("guarded migration plans, writes, snapshots, audits, and converges", async (context) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "robin-migrate-e2e-"));
  context.after(() => fs.rm(sandbox, { recursive: true, force: true }));
  const vault = path.join(sandbox, "base");
  const target = path.join(vault, "brain", "page.html");
  await fs.mkdir(path.dirname(target), { recursive: true });
  const before = page();
  await fs.writeFile(target, before);

  const dryRun = await runMigration({
    vault,
    target,
    to: "v0.3",
    mode: "dry-run",
    json: true,
  });
  assert.equal(dryRun.changed, true);
  assert.equal(dryRun.preview_reproducible, false);
  assert.equal(dryRun.article_preserved, true);
  assert.deepEqual(dryRun.preview.source_pairs, [
    {
      kind: "slack",
      ref: "urn:robin:legacy-source:slack",
    },
  ]);
  assert.equal(await fs.readFile(target, "utf8"), before);
  assert.deepEqual(await filesBelow(path.join(vault, ".history")), []);
  assert.deepEqual(await filesBelow(path.join(vault, ".robin", "transactions")), []);

  const written = await runMigration({
    vault,
    target,
    to: "v0.3",
    mode: "write",
    json: true,
  });
  assert.equal(written.written, true);
  const after = await fs.readFile(target, "utf8");
  assert.match(after, /name="robin:version" content="0\.3"/);
  assert.match(
    after,
    /name="robin:id" content="[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/,
  );
  assert.match(after, /name="robin:source-kind" content="slack"/);
  assert.match(after, /name="robin:source-ref" content="urn:robin:legacy-source:slack"/);
  assert.equal(after.includes(ARTICLE), true);

  const snapshots = await filesBelow(path.join(vault, ".history"));
  assert.equal(snapshots.length, 1);
  assert.equal(await fs.readFile(snapshots[0], "utf8"), before);

  const ledgerFiles = await filesBelow(path.join(vault, "inbox", "robin", "edits"));
  assert.equal(ledgerFiles.length, 1);
  const events = (await fs.readFile(ledgerFiles[0], "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "edit.saved");
  assert.equal(events[0].actor, "robin-page-migration");
  assert.equal(events[0].summary, "Format migration to v0.3");
  assert.equal(events[0].id, written.event_id);
  assert.equal(events[0].transaction_id, written.event_id);
  assert.equal(await fs.readFile(path.join(vault, events[0].snapshot), "utf8"), before);
  assert.deepEqual(await filesBelow(path.join(vault, ".robin", "transactions")), []);

  const converged = await runMigration({
    vault,
    target,
    to: "v0.3",
    mode: "check",
    json: true,
  });
  assert.equal(converged.changed, false);
  assert.equal(converged.preview_reproducible, true);
  assert.equal(converged.article_preserved, true);

  const outside = path.join(sandbox, "outside.html");
  await fs.writeFile(outside, before);
  await assert.rejects(
    runMigration({
      vault,
      target: outside,
      to: "v0.3",
      mode: "dry-run",
      json: true,
    }),
    /inside the selected vault/,
  );

  const inbox = path.join(vault, "inbox", "page.html");
  await fs.mkdir(path.dirname(inbox), { recursive: true });
  await fs.writeFile(inbox, before.replace("brain/page.html", "inbox/page.html"));
  await assert.rejects(
    runMigration({
      vault,
      target: inbox,
      to: "v0.3",
      mode: "dry-run",
      json: true,
    }),
    /outside executable page roots/,
  );

  const malformed = path.join(vault, "brain", "malformed.html");
  await fs.writeFile(
    malformed,
    before
      .replace("brain/page.html", "brain/malformed.html")
      .replace('  <meta name="robin:type" content="note">\n', ""),
  );
  const malformedBefore = await fs.readFile(malformed, "utf8");
  await assert.rejects(
    runMigration({
      vault,
      target: malformed,
      to: "v0.3",
      mode: "write",
      json: true,
    }),
    /requires exactly one non-empty robin:type/,
  );
  assert.equal(await fs.readFile(malformed, "utf8"), malformedBefore);
});

test("runtime freshness check fails closed on stale build output", async (context) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "robin-runtime-age-"));
  context.after(() => fs.rm(sandbox, { recursive: true, force: true }));
  const sourceRoot = path.join(sandbox, "src");
  const source = path.join(sourceRoot, "index.ts");
  const distEntry = path.join(sandbox, "dist", "index.js");
  await fs.mkdir(path.dirname(distEntry), { recursive: true });
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.writeFile(distEntry, "export {};\n");
  await fs.writeFile(source, "export {};\n");
  const now = Date.now() / 1000;
  await fs.utimes(distEntry, now - 10, now - 10);
  await fs.utimes(source, now, now);

  assert.throws(
    () =>
      assertBuiltRuntimeFresh([
        {
          name: "fixture-runtime",
          sourceRoot,
          distEntry,
        },
      ]),
    /stale built runtime for fixture-runtime/,
  );
});
