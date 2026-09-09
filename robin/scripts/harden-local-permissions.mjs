#!/usr/bin/env node

/**
 * Check or apply local privacy modes without reading or printing file contents.
 *
 * Git does not preserve private read modes, so a fresh clone can make tracked
 * ledgers world-readable again. This script is the repeatable local bootstrap.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "site-packages",
  "venv",
]);
const NON_SECRET_SUFFIXES = [".example", ".sample", ".template"];

function parseArgs(args) {
  const options = { mode: null, root: DEFAULT_ROOT, vault: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check" || arg === "--apply") options.mode = arg;
    else if (arg === "--root") options.root = path.resolve(args[++index] ?? "");
    else if (arg === "--vault") options.vault = path.resolve(args[++index] ?? "");
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.mode) throw new Error("--check or --apply is required");
  options.vault ??= path.join(options.root, "base");
  return options;
}

function isCredentialFilename(name) {
  const lower = name.toLowerCase();
  if (["example.env", "sample.env", "template.env"].includes(lower)) return false;
  if (NON_SECRET_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return false;
  return lower === ".env" || lower.startsWith(".env.") || lower.endsWith(".env");
}

function walk(root, visit) {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(absolute);
      } else if (entry.isFile()) {
        visit(absolute, entry.name);
      }
    }
  }
}

function walkPrivateTree(root, visitDirectory, visitFile) {
  if (!fs.existsSync(root)) return;
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return;
  visitDirectory(root);
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visitDirectory(absolute);
        stack.push(absolute);
      } else if (entry.isFile()) {
        visitFile(absolute);
      }
    }
  }
}

function modeOf(target) {
  return fs.statSync(target).mode & 0o777;
}

function octal(mode) {
  return mode.toString(8).padStart(3, "0");
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "Usage: harden-local-permissions.mjs --check|--apply [--root <path>] [--vault <path>]",
    );
    return 2;
  }

  if (process.platform === "win32") {
    console.log("Local POSIX permission check is not applicable on Windows.");
    return 0;
  }

  const targets = new Map();
  for (const directory of [options.root, options.vault]) {
    if (fs.existsSync(directory) && fs.statSync(directory).isDirectory()) {
      targets.set(directory, 0o700);
    }
  }
  for (const privateRoot of [
    path.join(options.vault, ".robin"),
    path.join(options.vault, ".history"),
  ]) {
    walkPrivateTree(
      privateRoot,
      (directory) => targets.set(directory, 0o700),
      (file) => targets.set(file, 0o600),
    );
  }
  walk(options.root, (absolute, name) => {
    if (isCredentialFilename(name)) targets.set(absolute, 0o600);
  });
  walk(path.join(options.vault, "inbox", "robin"), (absolute, name) => {
    if (name.endsWith(".jsonl")) targets.set(absolute, 0o600);
  });
  const memoryLedger = path.join(options.vault, "brain", "memory", "events.jsonl");
  if (fs.existsSync(memoryLedger)) targets.set(memoryLedger, 0o600);

  const drift = [];
  for (const [target, desired] of [...targets].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const current = modeOf(target);
    if (current === desired) continue;
    drift.push({ target, current, desired });
    if (options.mode === "--apply") fs.chmodSync(target, desired);
  }

  const display = (target) => {
    const relative = path.relative(options.root, target);
    return relative && !relative.startsWith("..") ? relative : target;
  };
  if (drift.length === 0) {
    console.log(`Local permissions: ${targets.size} private target(s) already hardened.`);
    return 0;
  }
  for (const item of drift) {
    console.log(
      `${options.mode === "--apply" ? "hardened" : "drift"} ${display(item.target)} ` +
        `${octal(item.current)} -> ${octal(item.desired)}`,
    );
  }
  if (options.mode === "--apply") {
    console.log(`Local permissions: hardened ${drift.length} target(s).`);
    return 0;
  }
  console.error(
    `Local permissions: ${drift.length} target(s) need hardening; rerun with --apply.`,
  );
  return 1;
}

process.exitCode = main();
