#!/usr/bin/env node

/**
 * Validate the workspace manifest without modifying repositories.
 *
 * JSON Schema documents the portable contract; this dependency-free checker
 * enforces the same core rules and verifies the local filesystem/remote claims.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

const ENUMS = {
  role: new Set([
    "clone",
    "local-project",
    "reference",
    "container",
    "worktree-root",
    "private-data",
  ]),
  lifecycle: new Set(["active", "reference", "archived", "scratch", "infrastructure"]),
  vcs: new Set(["git", "none"]),
  backup: new Set(["remote-git", "external-backup", "rebuildable", "required", "none-intentional"]),
  data_class: new Set(["company-private", "personal-private", "public", "mixed"]),
};

const REQUIRED_ENTRY_KEYS = ["id", "path", "role", "lifecycle", "vcs", "backup", "data_class"];
const ROOT_KEYS = new Set([
  "$schema",
  "schema_version",
  "repos_root",
  "policy",
  "vault",
  "entries",
]);
const VAULT_KEYS = new Set([
  "path",
  "backup",
  "backup_owner",
  "backup_due",
  "backup_system",
  "restore_tested_at",
  "data_class",
  "notes",
]);
const ENTRY_KEYS = new Set([
  ...REQUIRED_ENTRY_KEYS,
  "backup_owner",
  "backup_due",
  "backup_system",
  "restore_tested_at",
  "notes",
]);

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isValidUtcTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString().replace(".000Z", "Z") === value;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function hasOrigin(directory) {
  try {
    execFileSync("git", ["-C", directory, "remote", "get-url", "origin"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function validateBackupEvidence(record, prefix, subject, errors, warnings) {
  for (const key of ["backup_owner", "backup_system"]) {
    if (record[key] !== undefined && (typeof record[key] !== "string" || !record[key].trim())) {
      errors.push(`${prefix}.${key} must be a non-empty string when present`);
    }
  }
  if (record.backup_due !== undefined && !isValidDate(record.backup_due)) {
    errors.push(`${prefix}.backup_due must be a real YYYY-MM-DD date when present`);
  }
  if (record.restore_tested_at !== undefined && !isValidUtcTimestamp(record.restore_tested_at)) {
    errors.push(
      `${prefix}.restore_tested_at must be a real second-precision UTC timestamp when present`,
    );
  }
  if (record.backup === "external-backup") {
    for (const key of ["backup_owner", "backup_system", "restore_tested_at"]) {
      if (record[key] === undefined) {
        errors.push(`${prefix} backup=external-backup requires ${key}`);
      }
    }
  }
  if (record.backup === "required") {
    const owner =
      typeof record.backup_owner === "string" && record.backup_owner.trim()
        ? record.backup_owner
        : "unassigned";
    const due = isValidDate(record.backup_due) ? record.backup_due : "unset";
    warnings.push(`${subject} still requires a durable backup (owner=${owner}, due=${due})`);
  }
}

export function validateManifestDocument(document) {
  const errors = [];
  const warnings = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { errors: ["manifest root must be an object"], warnings };
  }
  for (const key of Object.keys(document)) {
    if (!ROOT_KEYS.has(key)) errors.push(`manifest has unsupported property ${key}`);
  }
  if (document.schema_version !== 1) errors.push("schema_version must equal 1");
  if (typeof document.repos_root !== "string" || !document.repos_root) {
    errors.push("repos_root must be a non-empty relative path");
  } else if (
    path.isAbsolute(document.repos_root) ||
    document.repos_root.split(/[\\/]/).includes("..")
  ) {
    errors.push("repos_root must not be absolute or contain ..");
  }
  if (typeof document.policy !== "string" || !document.policy) {
    errors.push("policy must point to the storage policy");
  }
  if (!document.vault || typeof document.vault !== "object" || Array.isArray(document.vault)) {
    errors.push("vault must be an object");
  } else {
    for (const key of Object.keys(document.vault)) {
      if (!VAULT_KEYS.has(key)) errors.push(`vault has unsupported property ${key}`);
    }
    if (document.vault.path !== "base") errors.push("vault.path must equal base");
    if (!["external-backup", "required"].includes(document.vault.backup)) {
      errors.push("vault.backup must be external-backup or required");
    }
    if (!ENUMS.data_class.has(document.vault.data_class)) {
      errors.push("vault.data_class has an unsupported value");
    }
    if (document.vault.notes !== undefined && typeof document.vault.notes !== "string") {
      errors.push("vault.notes must be a string when present");
    }
    validateBackupEvidence(document.vault, "vault", "base: canonical vault", errors, warnings);
  }
  if (!Array.isArray(document.entries)) {
    errors.push("entries must be an array");
    return { errors, warnings };
  }

  const ids = new Set();
  const paths = new Set();
  let previousPath = "";
  for (let index = 0; index < document.entries.length; index += 1) {
    const entry = document.entries[index];
    const prefix = `entries[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) errors.push(`${prefix} has unsupported property ${key}`);
    }
    for (const key of REQUIRED_ENTRY_KEYS) {
      if (entry[key] === undefined) errors.push(`${prefix} missing ${key}`);
    }
    if (typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(entry.id)) {
      errors.push(`${prefix}.id must be a lowercase stable identifier`);
    } else if (ids.has(entry.id)) {
      errors.push(`${prefix}.id duplicates ${entry.id}`);
    } else {
      ids.add(entry.id);
    }
    if (typeof entry.path !== "string" || !entry.path) {
      errors.push(`${prefix}.path must be a non-empty string`);
    } else {
      if (
        path.isAbsolute(entry.path) ||
        entry.path.split(/[\\/]/).includes("..") ||
        entry.path.includes("\\") ||
        !entry.path.startsWith(`${document.repos_root}/`)
      ) {
        errors.push(`${prefix}.path must be a relative child of ${document.repos_root}/`);
      }
      if (paths.has(entry.path)) errors.push(`${prefix}.path duplicates ${entry.path}`);
      paths.add(entry.path);
      if (previousPath && entry.path < previousPath) {
        errors.push(`${prefix}.path is out of lexical order`);
      }
      previousPath = entry.path;
    }
    for (const [key, allowed] of Object.entries(ENUMS)) {
      if (!allowed.has(entry[key])) errors.push(`${prefix}.${key} has an unsupported value`);
    }
    if (entry.backup === "remote-git") {
      if (entry.vcs !== "git") {
        errors.push(`${prefix} declares remote-git backup without git VCS`);
      }
      warnings.push(
        `${entry.path}: remote-git replicates committed objects but is not an independent backup`,
      );
    }
    if (entry.backup === "none-intentional" && entry.lifecycle !== "scratch") {
      errors.push(`${prefix} backup=none-intentional is allowed only for lifecycle=scratch`);
    }
    if (entry.backup === "rebuildable") {
      if (!["clone", "worktree-root"].includes(entry.role)) {
        errors.push(`${prefix} backup=rebuildable requires role=clone or worktree-root`);
      }
      if (!["reference", "scratch", "infrastructure"].includes(entry.lifecycle)) {
        errors.push(
          `${prefix} backup=rebuildable requires a disposable reference, scratch, or infrastructure lifecycle`,
        );
      }
      if (entry.role === "clone" && entry.vcs !== "git") {
        errors.push(`${prefix} a rebuildable clone requires vcs=git`);
      }
    }
    if (entry.role === "container" && entry.vcs !== "none") {
      errors.push(`${prefix} containers must use vcs=none`);
    }
    if (entry.notes !== undefined && typeof entry.notes !== "string") {
      errors.push(`${prefix}.notes must be a string when present`);
    }
    validateBackupEvidence(
      entry,
      prefix,
      `${entry.path}: ${entry.lifecycle} data`,
      errors,
      warnings,
    );
  }
  return { errors, warnings };
}

function discoverProjectRoots(reposRoot, maxDepth = 5) {
  const found = new Map();
  const ignored = new Set([
    ".git",
    ".next",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".cache",
  ]);
  const markers = new Set(["package.json", "pyproject.toml", "Cargo.toml", "go.mod"]);

  function walk(directory, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const isGitRoot = entries.some((entry) => entry.name === ".git");
    const hasProjectMarker = entries.some((entry) => entry.isFile() && markers.has(entry.name));
    if (isGitRoot) {
      found.set(directory, "git");
    } else if (hasProjectMarker) {
      found.set(directory, "project");
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || ignored.has(entry.name)) continue;
      walk(path.join(directory, entry.name), depth + 1);
    }
  }
  walk(reposRoot, 0);
  return found;
}

function validateFilesystem(document) {
  const errors = [];
  const warnings = [];
  const reposRoot = path.resolve(REPO_ROOT, document.repos_root);
  if (!inside(REPO_ROOT, reposRoot) || !fs.existsSync(reposRoot)) {
    return {
      errors: [`repos_root does not exist inside the workspace: ${document.repos_root}`],
      warnings,
    };
  }
  const vaultRoot = path.resolve(REPO_ROOT, document.vault.path);
  if (
    !inside(REPO_ROOT, vaultRoot) ||
    !fs.existsSync(vaultRoot) ||
    !fs.statSync(vaultRoot).isDirectory()
  ) {
    errors.push(`${document.vault.path}: canonical vault is missing or outside the workspace`);
  }

  const declared = new Map();
  for (const entry of document.entries) {
    if (!entry || typeof entry.path !== "string") continue;
    const absolute = path.resolve(REPO_ROOT, entry.path);
    declared.set(absolute, entry);
    if (
      !inside(reposRoot, absolute) ||
      !fs.existsSync(absolute) ||
      !fs.statSync(absolute).isDirectory()
    ) {
      errors.push(
        `${entry.path}: declared path is missing, not a directory, or outside repos_root`,
      );
      continue;
    }
    const hasGit = fs.existsSync(path.join(absolute, ".git"));
    if (entry.vcs === "git" && !hasGit) {
      errors.push(`${entry.path}: vcs=git but .git is missing`);
    }
    if (entry.vcs === "none" && hasGit) {
      errors.push(`${entry.path}: vcs=none but .git exists`);
    }
    if (entry.backup === "remote-git" && !hasOrigin(absolute)) {
      errors.push(`${entry.path}: remote-git backup requires an origin remote`);
    }
  }

  for (const [discovered, kind] of discoverProjectRoots(reposRoot)) {
    const exactDeclaration = declared.get(discovered);
    const coveredByDeclaredGitRoot = [...declared.entries()].some(
      ([declaredPath, entry]) =>
        entry.vcs === "git" && (declaredPath === discovered || inside(declaredPath, discovered)),
    );
    if (
      (kind === "git" && !exactDeclaration) ||
      (kind === "project" && !exactDeclaration && !coveredByDeclaredGitRoot)
    ) {
      errors.push(
        `${path.relative(REPO_ROOT, discovered)}: repository-like directory is absent from the manifest`,
      );
    }
  }
  return { errors, warnings };
}

function main(argv) {
  const documentOnly = argv.includes("--document-only");
  const strictBackups = argv.includes("--strict-backups");
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  const unknownFlags = argv.filter(
    (argument) =>
      argument.startsWith("--") &&
      argument !== "--document-only" &&
      argument !== "--strict-backups",
  );
  const manifestArg = positional[0] ?? "workspace.manifest.json";
  if (positional.length > 1 || unknownFlags.length > 0) {
    console.error(
      "Usage: check-workspace-manifest.mjs [manifest.json] [--document-only] [--strict-backups]",
    );
    return 2;
  }
  const manifestPath = path.resolve(REPO_ROOT, manifestArg);
  let document;
  try {
    document = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    console.error(`Workspace manifest cannot be read: ${error.message}`);
    return 1;
  }

  const shape = validateManifestDocument(document);
  const filesystem =
    shape.errors.length === 0 && !documentOnly
      ? validateFilesystem(document)
      : { errors: [], warnings: [] };
  const errors = [...shape.errors, ...filesystem.errors];
  const warnings = [...new Set([...shape.warnings, ...filesystem.warnings])];

  for (const warning of warnings) console.warn(`WARN: ${warning}`);
  if (errors.length > 0) {
    console.error(`Workspace manifest failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`  ${error}`);
    return 1;
  }
  if (strictBackups && warnings.length > 0) {
    console.error(
      `Workspace manifest backup gate failed with ${warnings.length} unresolved warning(s).`,
    );
    return 1;
  }
  console.log(
    `Workspace manifest: ${document.entries.length} entries valid${documentOnly ? " (document only)" : ""} (${warnings.length} backup warning(s)).`,
  );
  return 0;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) process.exitCode = main(process.argv.slice(2));
