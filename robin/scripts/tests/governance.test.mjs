import assert from "node:assert/strict";
import test from "node:test";
import { validateManifestDocument } from "../check-workspace-manifest.mjs";
import { parseMigrationArgs } from "../migrate-page.mjs";
import { formatFindings, scanAddedPatch, scanText } from "../scan-secrets.mjs";
import {
  validateFile,
  validateGlobalIdentities,
  validateJsonl,
} from "../validate-data-contract.mjs";

test("secret findings are precise and never echo the matched value", () => {
  const credential = ["xai", "A".repeat(32)].join("-");
  const findings = scanText(`safe\napi_key=${credential}\n`, "example.txt", 7);

  assert.deepEqual(findings, [{ rule: "xai-api-key", file: "example.txt", line: 8 }]);
  const output = formatFindings(findings);
  assert.match(output, /example\.txt:8 \[xai-api-key\] <redacted>/);
  assert.equal(output.includes(credential), false);

  const sensitivePathOutput = formatFindings([
    { rule: "xai-api-key", file: `captures/${credential}.txt`, line: 1 },
  ]);
  assert.equal(sensitivePathOutput.includes(credential), false);
  assert.match(sensitivePathOutput, /captures\/<redacted>\.txt/);
});

test("patch scanner checks additions but ignores removed credentials", () => {
  const credential = ["sk", "proj", "B".repeat(32)].join("-");
  const addedPatch = [
    "diff --git a/example.txt b/example.txt",
    "--- a/example.txt",
    "+++ b/example.txt",
    "@@ -1 +1,2 @@",
    " safe",
    `+token=${credential}`,
  ].join("\n");
  const removedPatch = [
    "diff --git a/example.txt b/example.txt",
    "--- a/example.txt",
    "+++ b/example.txt",
    "@@ -1 +1 @@",
    `-${credential}`,
    "+safe",
  ].join("\n");

  assert.deepEqual(scanAddedPatch(addedPatch), [
    { rule: "openai-api-key", file: "example.txt", line: 2 },
  ]);
  assert.deepEqual(scanAddedPatch(removedPatch), []);
});

test("canonical Robin HTML passes the strict changed-file contract", () => {
  const html = `<!doctype html>
<html><head>
<meta name="robin:version" content="0.2">
<meta name="robin:slug" content="example">
<meta name="robin:path" content="brain/example.html">
<meta name="robin:type" content="note">
<meta name="robin:updated" content="2026-07-25T10:20:30Z">
  </head><body><article data-robin-doc>Example</article></body></html>`;

  assert.deepEqual(validateFile("base/brain/example.html", html), []);
  assert.deepEqual(validateFile("base/brain/example.html", html.replaceAll('"', "'")), []);
});

test("HTML contract ignores inert tag-shaped text", () => {
  const html = `<!doctype html>
<html><head>
<meta name="robin:version" content="0.2">
<meta name="robin:slug" content="example">
<meta name="robin:path" content="brain/example.html">
<meta name="robin:type" content="note">
<meta name="robin:updated" content="2026-07-25T10:20:30Z">
<!-- <meta name="robin:version" content="9.9"><article data-robin-doc>fake</article> -->
<style>.fake { content: '<meta name="robin:path" content="brain/fake.html">'; }</style>
<script>const fake = '<article data-robin-doc><meta name="robin:id" content="bad">';</script>
<template><template><head>
<meta name="robin:version" content="9.9">
</head></template><article data-robin-doc>fake</article></template>
</head><body><article data-robin-doc>Example</article></body></html>`;

  assert.deepEqual(validateFile("base/brain/example.html", html), []);

  const fakeOnly = `<!doctype html><html><head>
<!-- <meta name="robin:version" content="0.2"><meta name="robin:path" content="brain/fake.html"> -->
<script>const fake = '<article data-robin-doc>';</script>
<template><head>
<meta name="robin:version" content="0.2">
<meta name="robin:path" content="brain/fake.html">
</head><article data-robin-doc>fake</article></template>
</head><body></body></html>`;
  const messages = validateFile("base/brain/fake.html", fakeOnly).map((item) => item.message);
  assert.ok(messages.some((message) => message.includes("exactly one <article")));
  assert.ok(messages.some((message) => message.includes("missing robin:version")));
  assert.ok(messages.some((message) => message.includes("missing robin:path")));
});

test("HTML contract safely decodes out-of-range numeric entities", () => {
  const html = `<!doctype html>
<html><head>
<meta name="robin:version" content="0.2">
<meta name="robin:slug" content="example">
<meta name="robin:path" content="brain/example.html">
<meta name="robin:type" content="note">
<meta name="robin:updated" content="2026-07-25T10:20:30Z">
<meta name="robin:summary" content="&#999999999999;">
</head><body><article data-robin-doc>Example</article></body></html>`;

  assert.deepEqual(validateFile("base/brain/example.html", html), []);
});

test("v0.3 Robin HTML accepts immutable identity and paired provenance tags", () => {
  const html = `<!doctype html>
<html><head>
<meta name="robin:version" content="0.3">
<meta name="robin:id" content="6caa6c3f-82f8-4273-adff-888df4acdf0e">
<meta name="robin:slug" content="example">
<meta name="robin:path" content="brain/example.html">
<meta name="robin:type" content="note">
<meta name="robin:updated" content="2026-07-25T10:20:30Z">
<meta name="robin:source-kind" content="web">
<meta name="robin:source-ref" content="https://example.test/source">
  </head><body><article data-robin-doc>Example</article></body></html>`;

  assert.deepEqual(validateFile("base/brain/example.html", html), []);
});

test("strict HTML reports version, path, and document-shell drift", () => {
  const html = `<!doctype html>
<html><head>
<meta name="robin:version" content="0.4">
<meta name="robin:slug" content="wrong">
<meta name="robin:path" content="/Users/example/brain/example.html">
<meta name="robin:type" content="note">
<meta name="robin:updated" content="2026-07-25">
</head><body>Example</body></html>`;

  const messages = validateFile("base/brain/example.html", html).map((item) => item.message);
  assert.ok(messages.some((message) => message.includes("data-robin-doc")));
  assert.ok(messages.some((message) => message.includes("version must be one of 0.2, 0.3")));
  assert.ok(messages.some((message) => message.includes("robin:path must equal")));
  assert.ok(messages.some((message) => message.includes("robin:slug")));
  assert.ok(messages.some((message) => message.includes("valid date-time")));
});

test("Robin-shaped output pages receive the strict HTML contract", () => {
  const robinOutput = `<!doctype html><html><head>
<meta name="robin:version" content="0.3">
<meta name="robin:slug" content="example">
<meta name="robin:path" content="out/example.html">
<meta name="robin:type" content="artifact">
<meta name="robin:updated" content="2026-07-25T10:20:30Z">
</head><body><article data-robin-doc>Example</article></body></html>`;
  const messages = validateFile("base/out/example.html", robinOutput).map((item) => item.message);

  assert.ok(messages.some((message) => message.includes("$.robin:id")));
  assert.deepEqual(
    validateFile(
      "base/out/raw-report.html",
      "<!doctype html><html><body>Raw artifact</body></html>",
    ),
    [],
  );
});

test("JSONL validation catches malformed rows and duplicate edit-event IDs", () => {
  const edit = {
    id: "edit-1",
    event: "edit.saved",
  };
  const input = [JSON.stringify(edit), "{not json}", JSON.stringify(edit)].join("\n");

  const findings = validateJsonl("base/inbox/robin/edits/2026-07.jsonl", input);
  assert.ok(findings.some((item) => item.message === "invalid JSONL row"));
  assert.ok(findings.some((item) => item.message === "duplicate edit-event id"));
  assert.ok(findings.some((item) => item.message.startsWith("JSONL schema:")));
});

test("changed-file identity index catches case-folded page and cross-file edit collisions", () => {
  const page = (id, slug) => `<!doctype html><html><head>
<meta name="robin:id" content="${id}">
</head><body><article data-robin-doc>${slug}</article></body></html>`;
  const edit = (id) => `${JSON.stringify({ id, event: "edit.created" })}\n`;
  const entries = [
    {
      file: "base/brain/first.html",
      content: page("6CAA6C3F-82F8-4273-ADFF-888DF4ACDF0E", "first"),
    },
    {
      file: "base/brain/second.html",
      content: page("6caa6c3f-82f8-4273-adff-888df4acdf0e", "second"),
    },
    {
      file: "base/inbox/robin/edits/2026-06.jsonl",
      content: edit("935E68DE-3C04-4F12-8A1C-F6B6FB054D1E"),
    },
    {
      file: "base/inbox/robin/edits/2026-07.jsonl",
      content: edit("935e68de-3c04-4f12-8a1c-f6b6fb054d1e"),
    },
  ];
  const findings = validateGlobalIdentities(entries, [
    "base/brain/second.html",
    "base/inbox/robin/edits/2026-07.jsonl",
  ]);

  assert.equal(findings.length, 2);
  assert.ok(findings.some((item) => item.message.includes("robin:id is globally duplicated")));
  assert.ok(findings.some((item) => item.message.includes("edit-event id is globally duplicated")));
});

function manifestEntry(overrides = {}) {
  return {
    id: "alpha",
    path: "repos/alpha",
    role: "clone",
    lifecycle: "active",
    vcs: "git",
    backup: "remote-git",
    data_class: "company-private",
    ...overrides,
  };
}

function manifest(entries) {
  return {
    schema_version: 1,
    repos_root: "repos",
    policy: "docs/governance/storage-policy.md",
    vault: {
      path: "base",
      backup: "external-backup",
      backup_owner: "data-platform",
      backup_system: "independent-object-store",
      restore_tested_at: "2026-07-26T09:00:00Z",
      data_class: "mixed",
    },
    entries,
  };
}

test("workspace manifest shape accepts a classified durable clone", () => {
  assert.deepEqual(
    validateManifestDocument(
      manifest([
        manifestEntry({
          backup: "external-backup",
          backup_owner: "data-platform",
          backup_system: "independent-object-store",
          restore_tested_at: "2026-07-26T09:00:00Z",
        }),
      ]),
    ),
    {
      errors: [],
      warnings: [],
    },
  );
});

test("workspace manifest treats remote Git as replication, not backup", () => {
  const result = validateManifestDocument(manifest([manifestEntry()]));

  assert.deepEqual(result.errors, []);
  assert.match(result.warnings[0], /remote-git .*not an independent backup/);
});

test("workspace manifest limits disposable backup modes", () => {
  const result = validateManifestDocument(
    manifest([
      manifestEntry({
        id: "active-rebuildable",
        path: "repos/active-rebuildable",
        backup: "rebuildable",
      }),
      manifestEntry({
        id: "durable-no-backup",
        path: "repos/durable-no-backup",
        backup: "none-intentional",
        lifecycle: "archived",
      }),
    ]),
  );

  assert.ok(
    result.errors.some((message) => message.includes("backup=rebuildable requires a disposable")),
  );
  assert.ok(
    result.errors.some((message) => message.includes("backup=none-intentional is allowed only")),
  );
});

test("workspace manifest accepts explicitly disposable storage", () => {
  const result = validateManifestDocument(
    manifest([
      manifestEntry({
        backup: "rebuildable",
        lifecycle: "reference",
      }),
      manifestEntry({
        id: "scratch",
        path: "repos/scratch",
        role: "local-project",
        lifecycle: "scratch",
        vcs: "none",
        backup: "none-intentional",
      }),
    ]),
  );

  assert.deepEqual(result, {
    errors: [],
    warnings: [],
  });
});

test("workspace manifest rejects duplicate paths and unstable ordering", () => {
  const duplicate = validateManifestDocument(
    manifest([manifestEntry(), manifestEntry({ id: "second" })]),
  );
  assert.ok(duplicate.errors.some((message) => message.includes("duplicates repos/alpha")));

  const unordered = validateManifestDocument(
    manifest([manifestEntry({ id: "beta", path: "repos/beta" }), manifestEntry()]),
  );
  assert.ok(unordered.errors.some((message) => message.includes("lexical order")));
});

test("workspace manifest rejects undeclared extension fields", () => {
  const result = validateManifestDocument({
    ...manifest([manifestEntry({ accidental: true })]),
    extra_root_field: true,
  });

  assert.ok(result.errors.some((message) => message.includes("extra_root_field")));
  assert.ok(result.errors.some((message) => message.includes("accidental")));
});

test("workspace manifest requires evidence before claiming an external backup", () => {
  const incomplete = validateManifestDocument(
    manifest([
      manifestEntry({
        backup: "external-backup",
      }),
    ]),
  );
  assert.ok(incomplete.errors.some((message) => message.includes("requires backup_owner")));
  assert.ok(incomplete.errors.some((message) => message.includes("requires restore_tested_at")));

  const complete = validateManifestDocument(
    manifest([
      manifestEntry({
        backup: "external-backup",
        backup_owner: "data-platform",
        backup_system: "independent-object-store",
        restore_tested_at: "2026-07-26T09:00:00Z",
      }),
    ]),
  );
  assert.deepEqual(complete, { errors: [], warnings: [] });
});

test("workspace manifest accounts for canonical vault recovery", () => {
  const unresolved = validateManifestDocument({
    ...manifest([]),
    vault: {
      path: "base",
      backup: "required",
      data_class: "mixed",
    },
  });
  assert.deepEqual(unresolved.errors, []);
  assert.match(unresolved.warnings[0], /base: canonical vault still requires a durable backup/);

  const missingProof = validateManifestDocument({
    ...manifest([]),
    vault: {
      path: "base",
      backup: "external-backup",
      backup_owner: "data-platform",
      data_class: "mixed",
    },
  });
  assert.ok(
    missingProof.errors.some((message) =>
      message.includes("vault backup=external-backup requires backup_system"),
    ),
  );
});

test("required backup warnings carry owner and deadline state", () => {
  const result = validateManifestDocument(
    manifest([
      manifestEntry({
        backup: "required",
        backup_owner: "data-platform",
        backup_due: "2026-08-31",
      }),
    ]),
  );
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings[0], /owner=data-platform, due=2026-08-31/);
});

test("safe page migration requires one explicit target and an explicit write mode", () => {
  assert.deepEqual(
    parseMigrationArgs(["--vault", "base", "--to", "v0.3", "base/brain/example.html"]),
    {
      vault: "base",
      to: "v0.3",
      target: "base/brain/example.html",
      mode: "dry-run",
      json: false,
    },
  );
  assert.equal(
    parseMigrationArgs([
      "--vault",
      "base",
      "--to",
      "v0.3",
      "--write",
      "--json",
      "base/brain/example.html",
    ])?.mode,
    "write",
  );
  assert.throws(
    () => parseMigrationArgs(["--vault", "base", "--to", "v0.3", "base/brain/*.html"]),
    /globs and directories are not allowed/,
  );
  assert.throws(
    () =>
      parseMigrationArgs([
        "--vault",
        "base",
        "--to",
        "v0.3",
        "--check",
        "--write",
        "base/brain/example.html",
      ]),
    /choose exactly one/,
  );
});
