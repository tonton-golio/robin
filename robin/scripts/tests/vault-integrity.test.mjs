import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateDocument, validateVault } from "../vault-integrity.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(TEST_DIR, "..", "vault-integrity.mjs");
const SCHEMA_DIR = path.resolve(TEST_DIR, "..", "..", "schemas", "v1");

function fixture(t) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robin-integrity-"));
  const vault = path.join(repoRoot, "base");
  fs.mkdirSync(path.join(vault, "brain", "memory"), { recursive: true });
  fs.writeFileSync(
    path.join(vault, "brain", "memory", "events.jsonl"),
    "",
    "utf8",
  );
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));

  const write = (relativePath, content) => {
    const absolutePath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
    return absolutePath;
  };
  const page = (relativeVaultPath, overrides = {}) => {
    const slug = overrides.slug ?? path.basename(relativeVaultPath, ".html");
    const declaredPath = overrides.path ?? relativeVaultPath;
    const version = overrides.version ?? "0.2";
    const extraMeta = Object.entries(overrides.meta ?? {})
      .flatMap(([name, rawValue]) => {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        return values.map(
          (value) => `  <meta name="${name}" content="${value}">`,
        );
      })
      .join("\n");
    return write(
      path.join("base", relativeVaultPath),
      `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${slug}</title>
  <meta content="${declaredPath}" name="robin:path">
  <meta name="robin:slug" content="${slug}">
  <meta name="robin:type" content="${overrides.type ?? "index"}">
  <meta name="robin:updated" content="2026-07-25T12:00:00Z">
  <meta name="robin:version" content="${version}">
${extraMeta}
</head>
<body><article data-robin-doc><h1>${slug}</h1></article></body>
</html>
`,
    );
  };

  return {
    repoRoot,
    vault,
    write,
    page,
    validate: () => validateVault({ repoRoot, vault, schemaDir: SCHEMA_DIR }),
  };
}

function finding(result, code) {
  return result.findings.filter((item) => item.code === code);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("capture manifest template conforms to the versioned schema", () => {
  const template = JSON.parse(
    fs.readFileSync(
      path.join(SCHEMA_DIR, "capture-manifest.template.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    validateDocument(template, "capture-manifest.schema.json", {
      schemaDir: SCHEMA_DIR,
    }),
    [],
  );
});

test("custom schema validator enforces not branches", () => {
  const transactionId = "4c0bba7d-4604-40c4-8ad9-535ce372f607";
  const event = {
    id: transactionId,
    transaction_id: transactionId,
    event: "edit.created",
    page_path: "brain/new.html",
    ts: "2026-07-25T12:00:00Z",
    origin: "mcp",
    before_hash: null,
    after_hash: "a".repeat(64),
    status: "open",
    schema_version: 2,
    kind: "knowledge",
  };
  const createdWithSnapshot = {
    ...event,
    snapshot: ".history/brain/new.html/snapshot.html",
  };
  const writeReceiptWithSource = {
    schema_version: 1,
    transaction_id: transactionId,
    operation: "write",
    created_at: event.ts,
    target_path: event.page_path,
    source_path: "brain/old.html",
    event,
  };

  assert.ok(
    validateDocument(createdWithSnapshot, "edit-event.schema.json", {
      schemaDir: SCHEMA_DIR,
    }).some((error) => error.message.includes("forbidden schema")),
  );
  assert.ok(
    validateDocument(
      writeReceiptWithSource,
      "transaction-receipt.schema.json",
      {
        schemaDir: SCHEMA_DIR,
      },
    ).some((error) => error.message.includes("forbidden schema")),
  );
  assert.ok(
    validateDocument(
      { ...event, ts: "2026-02-30T12:00:00Z" },
      "edit-event.schema.json",
      {
        schemaDir: SCHEMA_DIR,
      },
    ).some((error) => error.message.includes("valid date-time")),
  );
});

test("accepts a canonical page, valid ledgers, and an existing snapshot", (t) => {
  const f = fixture(t);
  const snapshot = "<html></html>";
  f.page("brain/_index.html");
  f.write(
    "base/brain/memory/events.jsonl",
    `${JSON.stringify({
      event: "memory.saved",
      memory: {
        id: "mem_example",
        type: "procedure",
        tier: "procedural",
        status: "active",
        scope: "global",
        subject: "Example",
        summary: "Example memory.",
        sources: [{ kind: "manual", ref: "test" }],
        created_at: "2026-07-25T12:00:00Z",
        updated_at: "2026-07-25T12:00:00Z",
      },
    })}\n`,
  );
  f.write("base/.history/brain/_index.html/snapshot.html", snapshot);
  f.write(
    "base/inbox/robin/edits/2026-07.jsonl",
    `${JSON.stringify({
      id: "935e68de-3c04-4f12-8a1c-f6b6fb054d1e",
      event: "edit.saved",
      page_path: "brain/_index.html",
      ts: "2026-07-25T12:00:00Z",
      origin: "mcp",
      before_hash: sha256(snapshot),
      after_hash: "d".repeat(64),
      snapshot: ".history/brain/_index.html/snapshot.html",
      status: "open",
      schema_version: 2,
    })}\n`,
  );

  assert.deepEqual(f.validate().findings, []);
});

test("accepts the complete pre-v1 memory.saved shape without weakening current validation", (t) => {
  const f = fixture(t);
  f.page("brain/legacy-memory.html");
  f.write(
    "base/brain/memory/events.jsonl",
    `${JSON.stringify({
      event: "memory.saved",
      memory: {
        id: "mem_legacy",
        type: "fact",
        tier: "semantic",
        status: "active",
        confidence: "medium",
        scope: "project:robin",
        text: "A historical memory row remains readable.",
        tags: ["legacy"],
        source: { kind: "meeting", ref: "logs/meetings/example.html" },
        created: "2026-07-25T12:00:00Z",
      },
    })}\n`,
  );

  assert.deepEqual(f.validate().findings, []);

  f.write(
    "base/brain/memory/events.jsonl",
    `${JSON.stringify({
      event: "memory.saved",
      memory: {
        id: "mem_new_invalid",
        text: "This is not enough for a current record.",
        source: { kind: "meeting", ref: "logs/meetings/example.html" },
        created: "not-a-date",
      },
    })}\n`,
  );
  assert.ok(finding(f.validate(), "memory.schema").length > 0);

  f.write(
    "base/brain/memory/events.jsonl",
    `${JSON.stringify({
      event: "memory.saved",
      memory: {
        id: "mem_mixed",
        text: "Legacy text with an incomplete modern shape.",
        summary: "Modern field should force strict validation.",
        source: { kind: "meeting", ref: "logs/meetings/example.html" },
        created: "2026-07-25T12:00:00Z",
      },
    })}\n`,
  );
  assert.ok(finding(f.validate(), "memory.schema").length > 0);
});

test("accepts staged v0.3 identity with optional, ordered provenance pairs", (t) => {
  const f = fixture(t);
  f.page("brain/identity-only.html", {
    version: "0.3",
    meta: {
      "robin:id": "16a43b26-c675-41ac-bc49-8c17efe98572",
    },
  });
  f.page("brain/with-provenance.html", {
    version: "0.3",
    meta: {
      "robin:id": "cc79f642-f38d-4835-9cf8-2038df08cbbc",
      "robin:source-kind": ["web", "web"],
      "robin:source-ref": [
        "https://example.test/one",
        "https://example.test/two",
      ],
    },
  });

  assert.deepEqual(f.validate().findings, []);
});

test("rejects incomplete v0.3 identity and unpaired typed provenance", (t) => {
  const f = fixture(t);
  f.page("brain/missing-id.html", { version: "0.3" });
  f.page("brain/missing-ref.html", {
    version: "0.3",
    meta: {
      "robin:id": "ff1a6511-e884-492b-97fc-fce197510f3e",
      "robin:source-kind": "web",
    },
  });
  f.page("brain/misaligned.html", {
    version: "0.3",
    meta: {
      "robin:id": "ac454ae7-a96e-4351-9a84-10087aa8304b",
      "robin:source-kind": ["web", "document"],
      "robin:source-ref": "https://example.test/one",
    },
  });
  f.page("brain/invalid-types.html", {
    version: "0.3",
    meta: {
      "robin:id": "not-a-uuid",
      "robin:source-kind": "fax",
      "robin:source-ref": "urn:example:source",
    },
  });

  const result = f.validate();
  assert.ok(
    finding(result, "page.schema").some((item) =>
      item.message.includes("$.robin:id is required"),
    ),
  );
  assert.ok(
    finding(result, "page.schema").some((item) =>
      item.message.includes("$.robin:source-ref is required"),
    ),
  );
  assert.equal(finding(result, "page.provenance").length, 1);
  assert.ok(
    finding(result, "page.schema").some(
      (item) =>
        item.message.includes("$.robin:id") &&
        item.message.includes("valid uuid"),
    ),
  );
  assert.ok(
    finding(result, "page.schema").some(
      (item) =>
        item.message.includes("$.robin:source-kind[0]") &&
        item.message.includes('"web"'),
    ),
  );
});

test("rejects duplicate immutable page identities", (t) => {
  const f = fixture(t);
  const id = "e7a3f282-b171-4cb3-bcd6-c56ef6a99981";
  f.page("brain/first.html", {
    version: "0.3",
    meta: { "robin:id": id },
  });
  f.page("brain/second.html", {
    version: "0.3",
    meta: { "robin:id": id.toUpperCase() },
  });

  const result = f.validate();
  assert.equal(finding(result, "page.id.duplicate").length, 1);
  assert.equal(finding(result, "page.id.case").length, 1);
  assert.match(
    finding(result, "page.id.duplicate")[0].message,
    /base\/brain\/first\.html/,
  );
});

test("full validation ignores tag-shaped text in comments, scripts, and styles", (t) => {
  const f = fixture(t);
  const canonicalPath = f.page("brain/structural.html");
  const canonical = fs.readFileSync(canonicalPath, "utf8").replace(
    "</head>",
    `<!-- <meta name="robin:version" content="9.9"><article data-robin-doc>fake</article> -->
<style>.fake { content: '<meta name="robin:path" content="brain/fake.html">'; }</style>
<script>const fake = '<article data-robin-doc><meta name="robin:id" content="bad">';</script>
</head>`,
  );
  fs.writeFileSync(canonicalPath, canonical, "utf8");

  const fakeOnly = `<!doctype html><html><head>
<!-- <meta name="robin:version" content="0.2"><meta name="robin:path" content="brain/fake-only.html"> -->
<script>const fake = '<article data-robin-doc>';</script>
</head><body></body></html>`;
  f.write("base/brain/fake-only.html", fakeOnly);

  const result = f.validate();
  assert.equal(
    result.findings.filter(
      (item) =>
        item.file.endsWith("structural.html") && item.severity === "error",
    ).length,
    0,
  );
  assert.equal(
    result.findings.filter(
      (item) =>
        item.file.endsWith("fake-only.html") && item.code === "page.article",
    ).length,
    1,
  );
  assert.equal(
    result.findings.filter(
      (item) =>
        item.file.endsWith("fake-only.html") && item.code === "page.version",
    ).length,
    1,
  );
});

test("reports exact page version/path and every unexpected brain file", (t) => {
  const f = fixture(t);
  f.page("brain/tasks/example.html", {
    version: "0.1",
    path: "brain/tasks/old-location.html",
  });
  f.write("base/brain/tasks/helper.py", 'print("legacy helper")\n');

  const result = f.validate();
  assert.equal(finding(result, "page.version").length, 1);
  assert.equal(finding(result, "page.path").length, 1);
  assert.equal(finding(result, "brain.non_html").length, 1);
  assert.match(
    finding(result, "page.path")[0].message,
    /brain\/tasks\/example\.html/,
  );
});

test("reports missing version and path through their dedicated checks", (t) => {
  const f = fixture(t);
  f.write(
    "base/brain/missing-meta.html",
    `<!doctype html>
<html><head>
  <meta name="robin:slug" content="missing-meta">
  <meta name="robin:type" content="knowledge">
  <meta name="robin:updated" content="2026-07-25T12:00:00Z">
</head><body><article data-robin-doc><h1>Missing</h1></article></body></html>`,
  );

  const result = f.validate();
  assert.equal(finding(result, "page.version").length, 1);
  assert.equal(finding(result, "page.path").length, 1);
  assert.doesNotMatch(
    finding(result, "page.schema")
      .map((item) => item.message)
      .join("\n"),
    /robin:(version|path)/,
  );
});

test("reports malformed and unknown ledger events with exact file lines", (t) => {
  const f = fixture(t);
  f.write(
    "base/brain/memory/events.jsonl",
    [
      JSON.stringify({
        event: "memory.resolved",
        id: "mem_1",
        status: "superseded",
        resolved_at: "2026-07-25T12:00:00Z",
        resolution: "Replaced.",
      }),
      '{"event":',
      JSON.stringify({ event: "memory.legacy", id: "mem_2" }),
      "",
    ].join("\n"),
  );
  f.write(
    "base/inbox/robin/annotations/2026-07.jsonl",
    `${JSON.stringify({ event: "annotation.needs_attention", id: "ann_1" })}\n`,
  );
  f.write(
    "base/inbox/robin/edits/2026-07.jsonl",
    `${JSON.stringify({
      id: "edit_1",
      event: "edit.saved",
      page_path: "brain/example.html",
      ts: "2026-07-25T12:00:00Z",
      origin: "web",
      before_hash: "abc",
      after_hash: "def",
      snapshot: ".history/brain/example.html/missing.html",
      status: "open",
    })}\n`,
  );

  const result = f.validate();
  assert.equal(finding(result, "memory.json.malformed")[0].line, 2);
  assert.equal(finding(result, "memory.event.unknown")[0].line, 3);
  assert.equal(finding(result, "annotations.event.unknown")[0].line, 1);
  assert.equal(finding(result, "edits.snapshot.missing")[0].line, 1);
});

test("edit IDs are unique across month buckets and compared case-insensitively", (t) => {
  const f = fixture(t);
  const id = "935e68de-3c04-4f12-8a1c-f6b6fb054d1e";
  const event = (ts, eventId) => ({
    id: eventId,
    event: "edit.created",
    page_path: "brain/example.html",
    ts,
    origin: "web",
    before_hash: null,
    after_hash: "a".repeat(64),
    status: "open",
    schema_version: 2,
  });
  f.write(
    "base/inbox/robin/edits/2026-06.jsonl",
    `${JSON.stringify(event("2026-06-30T12:00:00Z", id.toUpperCase()))}\n`,
  );
  f.write(
    "base/inbox/robin/edits/2026-07.jsonl",
    `${JSON.stringify(event("2026-07-01T12:00:00Z", id))}\n`,
  );

  const result = f.validate();
  assert.equal(finding(result, "edits.id.duplicate").length, 1);
  assert.match(
    finding(result, "edits.id.duplicate")[0].message,
    /2026-06\.jsonl:1/,
  );
});

test("snapshot evidence rejects symlinks and byte/hash mismatches", (t) => {
  const f = fixture(t);
  const outside = f.write("outside.html", "outside bytes");
  const symlinkSnapshot = path.join(
    f.vault,
    ".history",
    "brain",
    "symlink.html",
    "snapshot.html",
  );
  fs.mkdirSync(path.dirname(symlinkSnapshot), { recursive: true });
  fs.symlinkSync(outside, symlinkSnapshot);
  const mismatchedSnapshot = f.write(
    "base/.history/brain/mismatch.html/snapshot.html",
    "actual bytes",
  );
  assert.ok(fs.existsSync(mismatchedSnapshot));

  const saved = (overrides) => ({
    id: overrides.id,
    event: "edit.saved",
    page_path: overrides.pagePath,
    ts: "2026-07-25T12:00:00Z",
    origin: "web",
    before_hash: overrides.beforeHash,
    after_hash: "b".repeat(64),
    snapshot: overrides.snapshot,
    status: "open",
    schema_version: 2,
  });
  f.write(
    "base/inbox/robin/edits/2026-07.jsonl",
    [
      JSON.stringify(
        saved({
          id: "2fc342e8-e4f8-45a4-b614-e31147618d7d",
          pagePath: "brain/symlink.html",
          beforeHash: sha256("outside bytes"),
          snapshot: ".history/brain/symlink.html/snapshot.html",
        }),
      ),
      JSON.stringify(
        saved({
          id: "d52ae2c3-501f-4385-9e82-0cf03ed2daf0",
          pagePath: "brain/mismatch.html",
          beforeHash: sha256("intended bytes"),
          snapshot: ".history/brain/mismatch.html/snapshot.html",
        }),
      ),
      "",
    ].join("\n"),
  );

  const result = f.validate();
  assert.equal(finding(result, "edits.snapshot.symlink").length, 1);
  assert.equal(finding(result, "edits.snapshot.hash").length, 1);
});

test("flags a repository-root data surface outside ROBIN_VAULT", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.repoRoot, "inbox"));

  const result = f.validate();
  assert.equal(finding(result, "vault.shadow_root").length, 1);
  assert.equal(finding(result, "vault.shadow_root")[0].file, "inbox");
});

test("validates pending transaction receipts and their embedded edit event", (t) => {
  const f = fixture(t);
  const transactionId = "4c0bba7d-4604-40c4-8ad9-535ce372f607";
  const priorBytes = "<p>prior</p>";
  const snapshot = ".history/brain/old.html/snapshot.html";
  f.write(`base/${snapshot}`, priorBytes);
  const event = {
    id: transactionId,
    transaction_id: transactionId,
    event: "edit.moved",
    previous_path: "brain/old.html",
    page_path: "brain/new.html",
    ts: "2026-07-25T12:00:00Z",
    origin: "mcp",
    before_hash: sha256(priorBytes),
    after_hash: "e".repeat(64),
    snapshot,
    status: "open",
    schema_version: 2,
    kind: "knowledge",
  };
  f.write(
    `base/.robin/transactions/${transactionId}.json`,
    JSON.stringify({
      schema_version: 1,
      transaction_id: transactionId,
      operation: "move",
      created_at: "2026-07-25T12:00:00Z",
      source_path: "brain/old.html",
      target_path: "brain/new.html",
      event,
    }),
  );
  const conflictingTransactionId = "7f86ec35-a758-4a3b-81e9-b8278cb173bb";
  const conflictingEvent = {
    ...event,
    id: conflictingTransactionId,
    transaction_id: conflictingTransactionId,
  };
  f.write(
    `base/.robin/transactions/${conflictingTransactionId}.json`,
    JSON.stringify({
      schema_version: 1,
      transaction_id: conflictingTransactionId,
      operation: "move",
      created_at: conflictingEvent.ts,
      source_path: "brain/old.html",
      target_path: "brain/new.html",
      event: conflictingEvent,
    }),
  );
  const mismatchedTransactionId = "cf516335-ee07-436d-a5cc-5caf4208e7d6";
  f.write(
    `base/.robin/transactions/${mismatchedTransactionId}.json`,
    JSON.stringify({
      schema_version: 1,
      transaction_id: mismatchedTransactionId,
      operation: "move",
      created_at: event.ts,
      source_path: "brain/old.html",
      target_path: "brain/new.html",
      event,
    }),
  );
  f.write(
    "base/.robin/transactions/bad.json",
    JSON.stringify({
      schema_version: 99,
      transaction_id: "not-a-uuid",
      operation: "move",
      created_at: "yesterday",
      target_path: "brain/new.html",
      event,
      unknown: true,
    }),
  );

  const result = f.validate();
  assert.equal(finding(result, "transaction.pending").length, 1);
  assert.equal(finding(result, "transaction.id_mismatch").length, 1);
  assert.equal(finding(result, "transaction.path_conflict").length, 2);
  assert.ok(finding(result, "transaction.schema").length >= 4);
});

test("delete tombstones are allowed only when exactly paired and hash-valid", (t) => {
  const f = fixture(t);
  const transactionId = "61ca9a96-e8a0-48b3-8bbf-5e31f2b884b8";
  const priorBytes = "<p>delete me</p>";
  const snapshot = ".history/brain/delete-me.html/snapshot.html";
  const tombstonePath = `.robin/transactions/${transactionId}.deleted`;
  f.write(`base/${snapshot}`, priorBytes);
  f.write(`base/${tombstonePath}`, priorBytes);
  f.write("base/.robin/transactions/orphan.deleted", "orphan");
  const event = {
    id: transactionId,
    transaction_id: transactionId,
    event: "edit.deleted",
    page_path: "brain/delete-me.html",
    ts: "2026-07-25T12:00:00Z",
    origin: "mcp",
    before_hash: sha256(priorBytes),
    after_hash: null,
    snapshot,
    status: "open",
    schema_version: 2,
    kind: "knowledge",
  };
  f.write(
    `base/.robin/transactions/${transactionId}.json`,
    JSON.stringify({
      schema_version: 1,
      transaction_id: transactionId,
      operation: "delete",
      created_at: event.ts,
      target_path: event.page_path,
      tombstone_path: tombstonePath,
      event,
    }),
  );

  const result = f.validate();
  assert.equal(finding(result, "transaction.pending").length, 1);
  assert.equal(finding(result, "transaction.tombstone.orphan").length, 1);
  assert.equal(finding(result, "transaction.tombstone.hash").length, 0);
  assert.equal(
    result.findings.filter(
      (item) =>
        item.code === "transaction.unexpected_file" &&
        item.file.endsWith(`${transactionId}.deleted`),
    ).length,
    0,
  );
});

test("report mode inventories drift without failing while strict mode gates", (t) => {
  const f = fixture(t);
  f.page("brain/example.html", { version: "0.1" });
  const commonArgs = [
    SCRIPT_PATH,
    "--vault",
    f.vault,
    "--repo-root",
    f.repoRoot,
    "--schema-dir",
    SCHEMA_DIR,
  ];

  const strict = spawnSync(process.execPath, [...commonArgs, "--strict"], {
    encoding: "utf8",
  });
  const report = spawnSync(process.execPath, [...commonArgs, "--report"], {
    encoding: "utf8",
  });

  assert.equal(strict.status, 1);
  assert.equal(report.status, 0);
  assert.match(report.stdout, /read-only legacy report/);
  assert.match(report.stdout, /\[page\.version\]/);
});
