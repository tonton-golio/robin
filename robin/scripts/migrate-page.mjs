#!/usr/bin/env node

/**
 * Safely migrate one reviewed Robin page.
 *
 * Planning is read-only by default. --write composes the pure converter with
 * vault-io's cross-process lock, compare-and-swap precondition, history
 * snapshot, edit event, and crash-recovery receipt. Exactly one file is
 * accepted so an invocation cannot partially apply a batch.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateFile } from "./validate-data-contract.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const CONTRACT_PATH = path.join(REPO_ROOT, "robin", "schemas", "v1", "contract.json");
const CONVERTER_PATH = path.join(
  REPO_ROOT,
  "robin",
  "app",
  "packages",
  "converter",
  "dist",
  "index.js",
);
const VAULT_IO_PATH = path.join(
  REPO_ROOT,
  "robin",
  "app",
  "packages",
  "vault-io",
  "dist",
  "index.js",
);
const RUNTIME_PACKAGES = [
  {
    name: "@robin/converter",
    sourceRoot: path.join(REPO_ROOT, "robin", "app", "packages", "converter", "src"),
    distEntry: CONVERTER_PATH,
  },
  {
    name: "@robin/vault-io",
    sourceRoot: path.join(REPO_ROOT, "robin", "app", "packages", "vault-io", "src"),
    distEntry: VAULT_IO_PATH,
  },
];

function usage() {
  console.error(
    "Usage: migrate-page.mjs --vault <root> --to v0.2|v0.3 <page.html> [--dry-run|--check|--write] [--json]",
  );
  console.error("       default mode is --dry-run; --write accepts exactly one explicit file");
}

export function parseMigrationArgs(argv) {
  const options = {
    vault: null,
    to: null,
    target: null,
    mode: "dry-run",
    json: false,
  };
  let modeSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--vault") {
      options.vault = argv[++index] ?? null;
    } else if (argument === "--to") {
      options.to = argv[++index] ?? null;
    } else if (argument === "--dry-run" || argument === "--check" || argument === "--write") {
      if (modeSeen) throw new Error("choose exactly one of --dry-run, --check, or --write");
      options.mode = argument.slice(2);
      modeSeen = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--help" || argument === "-h") {
      return null;
    } else if (argument?.startsWith("--")) {
      throw new Error(`unknown argument: ${argument}`);
    } else if (argument) {
      if (options.target) throw new Error("exactly one page target is allowed");
      options.target = argument;
    }
  }
  if (!options.vault) throw new Error("--vault is required");
  if (options.to !== "v0.2" && options.to !== "v0.3") {
    throw new Error("--to must be v0.2 or v0.3");
  }
  if (!options.target) throw new Error("one explicit page target is required");
  if (options.target.includes("*") || !options.target.endsWith(".html")) {
    throw new Error(
      "target must be one explicit .html file; globs and directories are not allowed",
    );
  }
  return options;
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents, "utf8").digest("hex");
}

function articleHash(parsed, html) {
  const start = parsed.article?.position?.start.offset;
  const end = parsed.article?.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  return sha256(html.slice(start, end));
}

function previewMetadata(beforeMeta, afterMeta, previewReproducible) {
  const kinds = afterMeta["robin:source-kind"] ?? [];
  const refs = afterMeta["robin:source-ref"] ?? [];
  return {
    version_before: beforeMeta["robin:version"]?.[0] ?? "0.1",
    version_after: afterMeta["robin:version"]?.[0] ?? null,
    robin_id: afterMeta["robin:id"]?.[0] ?? null,
    identity_status: previewReproducible ? "preserved" : "ephemeral-preview",
    source_pairs: refs.map((ref, index) => ({
      kind: kinds[index] ?? null,
      ref,
    })),
  };
}

function resolveContainedPage(vaultArgument, targetArgument) {
  const vault = fs.realpathSync(path.resolve(vaultArgument));
  if (!fs.statSync(vault).isDirectory()) throw new Error("vault root is not a directory");

  const lexicalTarget = path.resolve(targetArgument);
  const targetStat = fs.lstatSync(lexicalTarget);
  if (targetStat.isSymbolicLink()) throw new Error("target must not be a symbolic link");
  if (!targetStat.isFile()) throw new Error("target is not a file");
  const target = fs.realpathSync(lexicalTarget);
  const relativePath = path.relative(vault, target).split(path.sep).join("/");
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("target must resolve inside the selected vault");
  }
  return { vault, target, relativePath };
}

function newestSourceMtime(root) {
  let newest = 0;
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        newest = Math.max(newest, fs.statSync(absolute).mtimeMs);
      }
    }
  }
  return newest;
}

export function assertBuiltRuntimeFresh(runtimes = RUNTIME_PACKAGES) {
  for (const runtime of runtimes) {
    if (!fs.existsSync(runtime.distEntry)) {
      throw new Error(
        `missing built runtime ${path.relative(REPO_ROOT, runtime.distEntry)}; run npm --prefix robin/app run build`,
      );
    }
    if (newestSourceMtime(runtime.sourceRoot) > fs.statSync(runtime.distEntry).mtimeMs) {
      throw new Error(
        `stale built runtime for ${runtime.name}; run npm --prefix robin/app run build`,
      );
    }
  }
}

async function loadRuntime() {
  assertBuiltRuntimeFresh();
  const converter = await import(pathToFileURL(CONVERTER_PATH).href);
  const vaultIo = await import(pathToFileURL(VAULT_IO_PATH).href);
  for (const [name, value] of [
    ["migrateV01ToV02", converter.migrateV01ToV02],
    ["migrateV02ToV03", converter.migrateV02ToV03],
    ["parseRobinHtmlCore", converter.parseRobinHtmlCore],
    ["executablePageRoots", converter.executablePageRoots],
    ["isExecutablePagePath", converter.isExecutablePagePath],
    ["writeWithHistory", vaultIo.writeWithHistory],
  ]) {
    if (typeof value !== "function") throw new Error(`built runtime is missing ${name}`);
  }
  return { converter, vaultIo };
}

function transformPage(converter, html, to, relativePath) {
  if (to === "v0.2") {
    return converter.migrateV01ToV02(html, {
      vaultRelativePath: relativePath,
    });
  }
  const versions = converter.parseRobinHtmlCore(html).metaMap["robin:version"] ?? [];
  if (versions.length > 1) {
    throw new Error("migration refuses duplicate robin:version metadata");
  }
  const version = versions[0] ?? "0.1";
  if (version === "0.3") {
    return converter.migrateV02ToV03(html, { vaultRelativePath: relativePath });
  }
  const v02 =
    version === "0.2"
      ? { html, changed: false }
      : converter.migrateV01ToV02(html, {
          vaultRelativePath: relativePath,
        });
  const v03 = converter.migrateV02ToV03(v02.html, {
    vaultRelativePath: relativePath,
  });
  return { html: v03.html, changed: v03.html !== html };
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const verb =
    result.mode === "write"
      ? result.written
        ? "migrated"
        : "unchanged"
      : result.changed
        ? "would migrate"
        : "already converged";
  console.log(`${verb}: ${result.relative_path}`);
  console.log(`  before ${result.before_hash}`);
  if (result.preview_after_hash) {
    console.log(`  preview ${result.preview_after_hash}`);
    if (!result.preview_reproducible) {
      console.log("  note    preview includes a fresh UUID; apply will intentionally differ");
    }
    console.log(
      `  article ${result.article_preserved ? "unchanged" : "changed"} ${result.article_hash_after}`,
    );
    if (result.preview) {
      console.log(
        `  identity ${result.preview.robin_id ?? "<none>"} (${result.preview.identity_status})`,
      );
      console.log(`  sources  ${result.preview.source_pairs.length} typed pair(s)`);
    }
  } else {
    console.log(`  after  ${result.after_hash}`);
  }
}

export async function runMigration(options) {
  const { vault, target, relativePath } = resolveContainedPage(options.vault, options.target);
  const { converter, vaultIo } = await loadRuntime();
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  const pageRoots = converter.executablePageRoots(contract);
  if (!converter.isExecutablePagePath(relativePath, pageRoots)) {
    throw new Error(
      `target is outside executable page roots (${pageRoots.join(", ")}): ${relativePath}`,
    );
  }

  const before = fs.readFileSync(target, "utf8");
  const beforeHash = sha256(before);
  const beforeParsed = converter.parseRobinHtmlCore(before);
  const beforeMeta = beforeParsed.metaMap;
  const previewReproducible = options.to !== "v0.3" || (beforeMeta["robin:id"] ?? []).length === 1;
  const transformed = transformPage(converter, before, options.to, relativePath);
  const afterParsed = converter.parseRobinHtmlCore(transformed.html);
  const logicalFile = `base/${relativePath}`;
  const findings = validateFile(logicalFile, transformed.html);
  if (findings.length > 0) {
    throw new Error(
      `post-migration contract failed: ${findings
        .map((finding) => `${finding.file}:${finding.line} ${finding.message}`)
        .join("; ")}`,
    );
  }
  const afterHash = sha256(transformed.html);
  const articleHashBefore = articleHash(beforeParsed, before);
  const articleHashAfter = articleHash(afterParsed, transformed.html);
  if (
    articleHashBefore === null ||
    articleHashAfter === null ||
    articleHashBefore !== articleHashAfter
  ) {
    throw new Error("migration invariant failed: canonical <article data-robin-doc> bytes changed");
  }

  if (options.mode !== "write") {
    return {
      mode: options.mode,
      to: options.to,
      relative_path: relativePath,
      changed: transformed.changed,
      before_hash: beforeHash,
      preview_after_hash: afterHash,
      preview_reproducible: previewReproducible,
      article_hash_before: articleHashBefore,
      article_hash_after: articleHashAfter,
      article_preserved: true,
      preview: previewMetadata(beforeMeta, afterParsed.metaMap, previewReproducible),
    };
  }

  const write = await vaultIo.writeWithHistory({
    absolutePath: target,
    html: transformed.html,
    vaultRoot: vault,
    expectedHash: beforeHash,
    origin: "cli",
    actor: "robin-page-migration",
    summary: `Format migration to ${options.to}`,
  });
  return {
    mode: "write",
    to: options.to,
    relative_path: relativePath,
    written: write.written,
    before_hash: write.beforeHash,
    after_hash: write.afterHash,
    event_id: write.event?.id ?? null,
  };
}

async function main(argv) {
  let options;
  try {
    options = parseMigrationArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    return 2;
  }
  if (!options) {
    usage();
    return 0;
  }

  try {
    const result = await runMigration(options);
    printResult(result, options.json);
    return options.mode === "check" && result.changed ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) process.exitCode = await main(process.argv.slice(2));
