#!/usr/bin/env node

/**
 * High-confidence credential scanner for Git additions.
 *
 * Hook/CI modes inspect added lines only, so known historical debt does not
 * block unrelated work. Findings report rule, path, and line number; the
 * matched value is never printed.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

export const SECRET_PATTERNS = [
  {
    id: "private-key",
    regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g,
  },
  {
    id: "xai-api-key",
    regex: /(?<![A-Za-z0-9])xai-[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: "anthropic-api-key",
    regex: /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: "openai-api-key",
    regex: /(?<![A-Za-z0-9])sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    id: "aws-access-key",
    regex: /(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/g,
  },
  {
    id: "slack-token",
    regex: /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    id: "github-token",
    regex: /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  },
  {
    id: "google-api-key",
    regex: /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}/g,
  },
];

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
}

export function scanText(text, file = "<text>", startLine = 1) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(lines[index])) {
        findings.push({
          rule: pattern.id,
          file,
          line: startLine + index,
        });
      }
    }
  }
  return findings;
}

export function scanAddedPatch(patch) {
  const findings = [];
  let file = "<unknown>";
  let newLine = 0;
  let inHunk = false;

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4);
      file = target === "/dev/null" ? "<deleted>" : target.replace(/^b\//, "");
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@ ")) {
      const match = /\+(\d+)(?:,\d+)?/.exec(line);
      newLine = match ? Number(match[1]) : 0;
      inHunk = true;
      continue;
    }
    if (!inHunk || file === "<deleted>") continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      findings.push(...scanText(line.slice(1), file, newLine));
      newLine += 1;
    } else if (line.startsWith(" ")) {
      newLine += 1;
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" does not consume a source line.
    }
  }

  return findings;
}

function patchForStaged() {
  return git([
    "-c",
    "core.quotePath=false",
    "diff",
    "--cached",
    "--no-ext-diff",
    "--no-color",
    "--unified=0",
    "--diff-filter=ACMR",
    "--",
  ]);
}

function patchForRange(base) {
  return git([
    "-c",
    "core.quotePath=false",
    "diff",
    "--no-ext-diff",
    "--no-color",
    "--unified=0",
    "--diff-filter=ACMR",
    `${base}...HEAD`,
    "--",
  ]);
}

function scanAllTracked() {
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const findings = [];
  for (const file of files) {
    const absolute = path.join(REPO_ROOT, file);
    let bytes;
    try {
      bytes = fs.readFileSync(absolute);
    } catch {
      continue;
    }
    if (bytes.length > 10 * 1024 * 1024 || bytes.includes(0)) continue;
    findings.push(...scanText(bytes.toString("utf8"), file));
  }
  return findings;
}

export function formatFindings(findings) {
  const lines = [`Potential credentials detected: ${findings.length}. Values are redacted.`];
  for (const finding of findings) {
    let safeFile = finding.file;
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      safeFile = safeFile.replace(pattern.regex, "<redacted>");
    }
    safeFile = safeFile.replace(/[\r\n\t]/g, "?");
    lines.push(`  ${safeFile}:${finding.line} [${finding.rule}] <redacted>`);
  }
  lines.push(
    "Rotate any real credential before removing it; see docs/governance/history-rewrite-runbook.md.",
  );
  return lines.join("\n");
}

function usage() {
  console.error("Usage: scan-secrets.mjs --staged | --range <git-ref> | --all");
}

function main(argv) {
  let findings;
  if (argv[0] === "--staged" && argv.length === 1) {
    findings = scanAddedPatch(patchForStaged());
  } else if (argv[0] === "--range" && argv[1] && argv.length === 2) {
    findings = scanAddedPatch(patchForRange(argv[1]));
  } else if (argv[0] === "--all" && argv.length === 1) {
    findings = scanAllTracked();
  } else {
    usage();
    return 2;
  }

  if (findings.length > 0) {
    console.error(formatFindings(findings));
    return 1;
  }
  console.log("Secret scan: no high-confidence credential patterns in scope.");
  return 0;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) process.exitCode = main(process.argv.slice(2));
