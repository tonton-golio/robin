#!/usr/bin/env node

/**
 * Read-only validation for changed durable-vault files.
 *
 * Strict Robin pages are validated on touch. Heterogeneous out/ artifacts keep
 * their raw HTML contract, but any metadata they do carry must remain portable.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHtmlContract, robinMetaValues } from "./html-contract.mjs";
import {
  isLegacyMemorySavedEvent,
  validateLegacyMemorySavedEvent,
  validateDocument,
} from "./vault-integrity.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const SCHEMA_DIR = path.join(REPO_ROOT, "robin", "schemas", "v1");
const VAULT_CONTRACT = JSON.parse(
  fs.readFileSync(path.join(SCHEMA_DIR, "contract.json"), "utf8"),
);
const PAGE_SCHEMA = JSON.parse(
  fs.readFileSync(
    path.join(SCHEMA_DIR, VAULT_CONTRACT.page.metadata_schema),
    "utf8",
  ),
);
const versionSchema = PAGE_SCHEMA.properties?.["robin:version"];
const PAGE_FORMAT_VERSIONS =
  typeof versionSchema?.const === "string"
    ? [versionSchema.const]
    : versionSchema?.enum;
const PAGE_DEFAULT_FORMAT_VERSION = VAULT_CONTRACT.page.default_format_version;
if (
  !Array.isArray(PAGE_FORMAT_VERSIONS) ||
  !PAGE_FORMAT_VERSIONS.every((value) => typeof value === "string") ||
  !PAGE_FORMAT_VERSIONS.includes(PAGE_DEFAULT_FORMAT_VERSION)
) {
  throw new Error(
    "page metadata versions must include contract page.default_format_version",
  );
}
const PAGE_FORMAT_VERSION_SET = new Set(PAGE_FORMAT_VERSIONS);
const REPEATABLE_PAGE_META = new Set(
  Object.entries(PAGE_SCHEMA.properties ?? {})
    .filter(([, schema]) => schema.type === "array")
    .map(([name]) => name),
);
const ALLOWED_BRAIN_NON_HTML_PATHS = new Set(
  (VAULT_CONTRACT.brain.allowed_non_html_paths ?? []).map(
    (file) => `base/${file}`,
  ),
);
const ALLOWED_BRAIN_NON_HTML_BASENAMES = new Set(
  VAULT_CONTRACT.brain.allowed_non_html_basenames ?? [],
);

function ledgerSchemaForPath(file) {
  const relative = file.startsWith("base/") ? file.slice("base/".length) : file;
  for (const ledger of VAULT_CONTRACT.ledgers ?? []) {
    if (ledger.path && relative === ledger.path) return ledger.schema;
    if (
      ledger.directory &&
      relative.startsWith(`${ledger.directory}/`) &&
      relative.endsWith(ledger.suffix)
    ) {
      return ledger.schema;
    }
  }
  return null;
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
}

function splitNull(text) {
  return text.split("\0").filter(Boolean);
}

function pathsForMode(mode, value) {
  if (mode === "--staged") {
    return splitNull(
      git([
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--diff-filter=ACMR",
        "--",
      ]),
    );
  }
  if (mode === "--range") {
    return splitNull(
      git([
        "diff",
        "--name-only",
        "-z",
        "--diff-filter=ACMR",
        `${value}...HEAD`,
        "--",
      ]),
    );
  }
  if (mode === "--all") return splitNull(git(["ls-files", "-z"]));
  throw new Error(`unsupported mode: ${mode}`);
}

function readForMode(file, mode) {
  if (mode === "--staged") {
    try {
      return git(["show", `:${file}`]);
    } catch {
      return null;
    }
  }
  try {
    return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  } catch {
    return null;
  }
}

export function parseRobinMeta(html) {
  return robinMetaValues(html);
}

function finding(file, message, line = 1) {
  return { file, line, message };
}

function validateStrictHtml(file, html) {
  const findings = [];
  const parsedHtml = parseHtmlContract(html);
  const meta = new Map(
    [...parsedHtml.robinMeta].map(([name, entries]) => [
      name,
      entries.map((entry) => entry.content),
    ]),
  );
  const expectedPath = file.slice("base/".length);
  const normalizedMeta = {};

  if (!/^\s*<!doctype html>/i.test(html)) {
    findings.push(finding(file, "missing HTML doctype"));
  }
  if (parsedHtml.articleDataRobinDocCount !== 1) {
    findings.push(
      finding(
        file,
        `must contain exactly one <article data-robin-doc>; found ${parsedHtml.articleDataRobinDocCount}`,
      ),
    );
  }
  if (parsedHtml.hasLegacyJsonScript) {
    findings.push(
      finding(
        file,
        "legacy embedded JSON script is forbidden",
        parsedHtml.legacyJsonScriptLine ?? 1,
      ),
    );
  }
  for (const [key, values] of meta) {
    normalizedMeta[key] = REPEATABLE_PAGE_META.has(key) ? values : values[0];
    if (!REPEATABLE_PAGE_META.has(key) && values.length > 1) {
      findings.push(finding(file, `${key} metadata must appear at most once`));
    }
  }

  const version = meta.get("robin:version")?.[0];
  if (version === undefined) {
    findings.push(finding(file, "missing robin:version metadata"));
  } else if (!PAGE_FORMAT_VERSION_SET.has(version)) {
    findings.push(
      finding(
        file,
        `robin:version must be one of ${PAGE_FORMAT_VERSIONS.join(", ")}, got ${JSON.stringify(version)}`,
      ),
    );
  }

  const storedPath = meta.get("robin:path")?.[0];
  if (storedPath === undefined) {
    findings.push(finding(file, "missing robin:path metadata"));
  } else if (storedPath !== expectedPath) {
    findings.push(
      finding(
        file,
        `robin:path must equal ${JSON.stringify(expectedPath)}, got ${JSON.stringify(storedPath)}`,
      ),
    );
  }

  const slug = meta.get("robin:slug")?.[0];
  const expectedSlug = path.posix.basename(file, ".html");
  if (slug !== undefined && slug !== expectedSlug) {
    findings.push(
      finding(
        file,
        `robin:slug must equal basename ${JSON.stringify(expectedSlug)}`,
      ),
    );
  }

  for (const error of validateDocument(
    normalizedMeta,
    VAULT_CONTRACT.page.metadata_schema,
    {
      schemaDir: SCHEMA_DIR,
    },
  )) {
    if (
      error.instancePath === "$.robin:version" ||
      error.instancePath === "$.robin:path"
    ) {
      continue;
    }
    findings.push(finding(file, `${error.instancePath} ${error.message}`));
  }

  const pageId = meta.get("robin:id")?.[0];
  if (pageId && pageId !== pageId.toLowerCase()) {
    findings.push(
      finding(file, "robin:id must use lowercase canonical UUID spelling"),
    );
  }

  const sourceKinds = normalizedMeta["robin:source-kind"];
  const sourceRefs = normalizedMeta["robin:source-ref"];
  if (
    Array.isArray(sourceKinds) &&
    Array.isArray(sourceRefs) &&
    sourceKinds.length !== sourceRefs.length
  ) {
    findings.push(
      finding(
        file,
        `robin:source-kind and robin:source-ref must form ordered pairs; got ${sourceKinds.length} kind tag(s) and ${sourceRefs.length} ref tag(s)`,
      ),
    );
  }

  return findings;
}

function validateArtifactHtml(file, html) {
  const findings = [];
  const meta = parseRobinMeta(html);
  const storedPath = meta.get("robin:path")?.[0];
  if (storedPath !== undefined) {
    const expectedPath = file.slice("base/".length);
    if (
      path.posix.isAbsolute(storedPath) ||
      /^[A-Za-z]:[\\/]/.test(storedPath)
    ) {
      findings.push(finding(file, "robin:path must be vault-relative"));
    } else if (storedPath !== expectedPath) {
      findings.push(
        finding(
          file,
          `robin:path must equal ${JSON.stringify(expectedPath)}, got ${JSON.stringify(storedPath)}`,
        ),
      );
    }
  }
  const version = meta.get("robin:version")?.[0];
  if (version !== undefined && !PAGE_FORMAT_VERSION_SET.has(version)) {
    findings.push(
      finding(
        file,
        `robin:version must be one of ${PAGE_FORMAT_VERSIONS.join(", ")} when present`,
      ),
    );
  }
  return findings;
}

export function validateJsonl(file, text) {
  const findings = [];
  const editIds = new Map();
  const schema = ledgerSchemaForPath(file);
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    let row;
    try {
      row = JSON.parse(lines[index]);
    } catch {
      findings.push(finding(file, "invalid JSONL row", index + 1));
      continue;
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      findings.push(finding(file, "JSONL row must be an object", index + 1));
      continue;
    }

    const relativeLedgerPath = file.startsWith("base/")
      ? file.slice("base/".length)
      : file;
    const legacyMemory =
      relativeLedgerPath === "brain/memory/events.jsonl" &&
      isLegacyMemorySavedEvent(row);
    if (schema) {
      const schemaErrors = legacyMemory
        ? validateLegacyMemorySavedEvent(row) ?? []
        : validateDocument(row, schema, { schemaDir: SCHEMA_DIR });
      for (const error of schemaErrors) {
        findings.push(
          finding(
            file,
            `JSONL schema: ${error.instancePath} ${error.message}`,
            index + 1,
          ),
        );
      }
    }

    if (file.includes("/inbox/robin/edits/") && typeof row.id === "string") {
      const identity = row.id.toLowerCase();
      const first = editIds.get(identity);
      if (first) {
        findings.push(
          finding(
            file,
            JSON.stringify(first.row) === JSON.stringify(row)
              ? "duplicate edit-event id"
              : "duplicate edit-event id with conflicting payload",
            index + 1,
          ),
        );
      } else {
        editIds.set(identity, { line: index + 1, row });
      }
    }
  }
  return findings;
}

export function validateFile(file, content) {
  if (file.startsWith("base/brain/")) {
    if (ALLOWED_BRAIN_NON_HTML_PATHS.has(file)) {
      return file.endsWith(".jsonl") ? validateJsonl(file, content) : [];
    }
    if (ALLOWED_BRAIN_NON_HTML_BASENAMES.has(path.posix.basename(file))) {
      return [];
    }
    if (!file.endsWith(".html")) {
      return [
        finding(
          file,
          "brain/ file is not allowed by robin/schemas/v1/contract.json",
        ),
      ];
    }
    return validateStrictHtml(file, content);
  }

  if (file.startsWith("base/logs/") && file.endsWith(".html")) {
    return validateStrictHtml(file, content);
  }

  if (file.startsWith("base/out/") && file.endsWith(".html")) {
    return parseHtmlContract(content).articleDataRobinDocCount > 0
      ? validateStrictHtml(file, content)
      : validateArtifactHtml(file, content);
  }

  if (
    file.startsWith("base/inbox/archived/outputs/") &&
    file.endsWith(".html")
  ) {
    return validateArtifactHtml(file, content);
  }

  if (file.startsWith("base/") && file.endsWith(".jsonl")) {
    return validateJsonl(file, content);
  }
  return [];
}

function isPageIdentityFile(file, content) {
  if (file.startsWith("base/brain/") && file.endsWith(".html")) return true;
  if (
    (file.startsWith("base/logs/") || file.startsWith("base/out/")) &&
    file.endsWith(".html")
  ) {
    return parseHtmlContract(content).articleDataRobinDocCount > 0;
  }
  return false;
}

/**
 * Repository-wide uniqueness checks used by staged/range validation. Findings
 * are emitted only on selected files, but identities are indexed from every
 * tracked durable page/edit ledger so a new file cannot collide with an
 * unchanged one.
 */
export function validateGlobalIdentities(entries, selectedFiles) {
  const selected = selectedFiles
    ? new Set(selectedFiles)
    : new Set(entries.map((entry) => entry.file));
  const findings = [];
  const pageIds = new Map();
  const editIds = new Map();

  for (const { file, content } of entries) {
    if (isPageIdentityFile(file, content)) {
      const idEntry = parseHtmlContract(content).robinMeta.get("robin:id")?.[0];
      if (idEntry?.content) {
        const identity = idEntry.content.toLowerCase();
        const values = pageIds.get(identity) ?? [];
        values.push({ file, line: idEntry.line, id: idEntry.content });
        pageIds.set(identity, values);
      }
    }

    if (!file.includes("/inbox/robin/edits/") || !file.endsWith(".jsonl"))
      continue;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].trim()) continue;
      try {
        const row = JSON.parse(lines[index]);
        if (
          !row ||
          typeof row !== "object" ||
          typeof row.id !== "string" ||
          !row.id
        )
          continue;
        const identity = row.id.toLowerCase();
        const values = editIds.get(identity) ?? [];
        values.push({ file, line: index + 1, id: row.id, row });
        editIds.set(identity, values);
      } catch {
        // Per-file JSONL validation owns malformed-row diagnostics.
      }
    }
  }

  for (const values of pageIds.values()) {
    if (values.length < 2) continue;
    for (const current of values) {
      if (!selected.has(current.file)) continue;
      const peers = values
        .filter((candidate) => candidate !== current)
        .map((candidate) => `${candidate.file}:${candidate.line}`)
        .join(", ");
      findings.push(
        finding(
          current.file,
          `robin:id is globally duplicated (case-insensitive); also declared at ${peers}`,
          current.line,
        ),
      );
    }
  }

  for (const values of editIds.values()) {
    if (new Set(values.map((value) => value.file)).size < 2) continue;
    for (const current of values) {
      if (!selected.has(current.file)) continue;
      const peers = values
        .filter((candidate) => candidate.file !== current.file)
        .map((candidate) => `${candidate.file}:${candidate.line}`)
        .join(", ");
      findings.push(
        finding(
          current.file,
          `edit-event id is globally duplicated (case-insensitive); also declared at ${peers}`,
          current.line,
        ),
      );
    }
  }

  return findings;
}

function usage() {
  console.error(
    "Usage: validate-data-contract.mjs --staged | --range <git-ref> | --all",
  );
}

function main(argv) {
  const mode = argv[0];
  const value = argv[1];
  if (
    !["--staged", "--range", "--all"].includes(mode) ||
    (mode === "--range" && !value) ||
    (mode !== "--range" && argv.length !== 1) ||
    (mode === "--range" && argv.length !== 2)
  ) {
    usage();
    return 2;
  }

  let files;
  try {
    files = pathsForMode(mode, value);
  } catch (error) {
    console.error(
      `Data-contract validation could not select files: ${error.message}`,
    );
    return 2;
  }

  const findings = [];
  const selectedFiles = new Set(files);
  let checked = 0;
  for (const file of files) {
    const content = readForMode(file, mode);
    if (content === null) continue;
    const fileFindings = validateFile(file, content);
    if (
      file.startsWith("base/brain/") ||
      file.startsWith("base/logs/") ||
      file.startsWith("base/out/") ||
      file.endsWith(".jsonl")
    ) {
      checked += 1;
    }
    findings.push(...fileFindings);
  }

  let identityFiles;
  try {
    identityFiles = splitNull(git(["ls-files", "-z"]));
  } catch (error) {
    console.error(
      `Data-contract validation could not index repository identities: ${error.message}`,
    );
    return 2;
  }
  const identityEntries = [];
  for (const file of identityFiles) {
    if (
      !file.endsWith(".html") &&
      !(file.includes("/inbox/robin/edits/") && file.endsWith(".jsonl"))
    ) {
      continue;
    }
    const content = readForMode(file, mode);
    if (content !== null) identityEntries.push({ file, content });
  }
  findings.push(...validateGlobalIdentities(identityEntries, selectedFiles));

  if (findings.length > 0) {
    console.error(
      `Data-contract validation failed with ${findings.length} issue(s):`,
    );
    for (const item of findings) {
      console.error(`  ${item.file}:${item.line} ${item.message}`);
    }
    return 1;
  }
  console.log(`Data-contract validation: ${checked} in-scope file(s) passed.`);
  return 0;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) process.exitCode = main(process.argv.slice(2));
