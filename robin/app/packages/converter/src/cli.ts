#!/usr/bin/env node
/**
 * Robin converter CLI.
 *
 * Usage:
 *   robin-convert <input.md> [--out <path>] [--vault <root>]
 *   robin-convert --batch <vault-root>
 *   robin-convert migrate --to v0.2|v0.3 <path-or-glob>... [--vault <root>] --dry-run|--check
 *   echo '...' | robin-convert --stdin --out brain/foo.html
 *
 * In batch mode, recursively converts legacy .md files under `<vault>/brain/`
 * and `<vault>/out/`, writing canonical `.html` siblings next to them.
 * Source .md files are never modified by this command.
 *
 * In migrate mode, v0.2 removes legacy JSON payloads; v0.3 adds immutable page
 * IDs and typed source-kind/source-ref provenance. Both preserve article bytes
 * and are idempotent. v0.3 chains through v0.2 when necessary.
 *
 *   --dry-run   Print which files would change without writing.
 *   --check     Exit non-zero if any file would change. Implies --dry-run.
 *   Writes use robin/scripts/migrate-page.mjs so they share vault locks,
 *   compare-and-swap, history, audit events, and recovery receipts.
 *
 * SKIPPED files (event streams that stay as markdown):
 *   - logs/changelog.md
 *   - logs/ingest-log.md
 *   - any file whose frontmatter type is `log`
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { convertMarkdown, parseRobinHtmlCore } from "./index.js";
import {
  type ExecutableContract,
  executablePageRoots,
  isExecutablePagePath,
} from "./migration-scope.js";
import { migrateV01ToV02 } from "./migrations/v0.1-to-v0.2.js";
import { migrateV02ToV03 } from "./migrations/v0.2-to-v0.3.js";

const SKIP_FILES = new Set(["changelog.md", "ingest-log.md", "repo-log.md"]);
const EXECUTABLE_CONTRACT_PATH = fileURLToPath(
  new URL("../../../../schemas/v1/contract.json", import.meta.url),
);

function usage(): never {
  console.error("Usage: robin-convert <input.md> [--out <path>] [--vault <root>]");
  console.error("       robin-convert --batch <vault-root>");
  console.error(
    "       robin-convert migrate --to v0.2|v0.3 <path-or-glob>... [--vault <root>] (--dry-run|--check)",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  if (args[0] === "migrate") {
    await runMigrate(args.slice(1));
    return;
  }

  if (args[0] === "--batch") {
    const vault = args[1];
    if (!vault) usage();
    batchConvert(vault);
    return;
  }

  if (args[0] === "--stdin") {
    const outFlag = args.indexOf("--out");
    if (outFlag < 0) usage();
    const outPath = args[outFlag + 1];
    if (!outPath) usage();
    const md = fs.readFileSync(0, "utf8");
    const result = convertMarkdown(md, { outputPath: outPath });
    process.stdout.write(result.html);
    return;
  }

  // Single-file mode
  const inputPath = args[0];
  if (!inputPath) usage();
  const outFlag = args.indexOf("--out");
  const vaultFlag = args.indexOf("--vault");
  const explicitOutput = args[outFlag + 1];
  const explicitVault = args[vaultFlag + 1];
  const md = fs.readFileSync(inputPath, "utf8");

  let outputPath: string;
  if (outFlag >= 0 && explicitOutput) {
    outputPath = explicitOutput;
  } else if (vaultFlag >= 0 && explicitVault) {
    outputPath = path.relative(explicitVault, inputPath).replace(/\.md$/, ".html");
  } else {
    outputPath = path.basename(inputPath).replace(/\.md$/, ".html");
  }

  const stat = fs.statSync(inputPath);
  const result = convertMarkdown(md, { outputPath, updated: stat.mtime });
  process.stdout.write(result.html);

  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.error(`[warn] ${w}`);
  }
}

function batchConvert(vaultRoot: string) {
  const sourceTargets = ["brain", "out"];
  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const top of sourceTargets) {
    const sourceRoot = path.join(vaultRoot, top);
    if (!fs.existsSync(sourceRoot)) {
      console.warn(`[skip] ${sourceRoot} does not exist`);
      continue;
    }
    walk(sourceRoot, (file) => {
      if (!file.endsWith(".md")) return;
      const base = path.basename(file);
      if (SKIP_FILES.has(base)) {
        skipped++;
        return;
      }
      const relFromVault = path.relative(vaultRoot, file); // e.g. "brain/_index.html" during legacy migration
      const htmlRel = relFromVault.replace(/\.md$/, ".html");
      const outAbs = path.join(vaultRoot, htmlRel);

      try {
        const md = fs.readFileSync(file, "utf8");
        // Quick log-type check: if frontmatter contains `type: log`, skip.
        if (/^---[\s\S]*?\btype:\s*log\b/.test(md.slice(0, 1000))) {
          skipped++;
          return;
        }
        const stat = fs.statSync(file);
        const result = convertMarkdown(md, { outputPath: htmlRel, updated: stat.mtime });
        fs.mkdirSync(path.dirname(outAbs), { recursive: true });
        fs.writeFileSync(outAbs, result.html, "utf8");
        converted++;
        if (result.warnings.length > 0) {
          for (const w of result.warnings) console.warn(`[warn] ${relFromVault}: ${w}`);
        }
      } catch (err) {
        failed++;
        console.error(`[fail] ${relFromVault}: ${(err as Error).message}`);
      }
    });
  }

  console.error(`\nDone. converted=${converted} skipped=${skipped} failed=${failed}`);
  console.error("HTML written next to legacy source .md files (source files untouched)");
}

function walk(dir: string, fn: (file: string) => void) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, fn);
    else if (entry.isFile()) fn(full);
  }
}

// ── migrate subcommand ──────────────────────────────────────────────────────

async function runMigrate(args: string[]): Promise<void> {
  // Parse flags + positional paths.
  let to: string | null = null;
  let vaultRootArg: string | null = null;
  let dryRun = false;
  let check = false;
  const targets: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--to") {
      to = args[++i] ?? null;
    } else if (a === "--vault") {
      vaultRootArg = args[++i] ?? null;
      if (!vaultRootArg) {
        console.error("[migrate] --vault requires a root path");
        process.exit(2);
      }
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--check") {
      check = true;
      dryRun = true;
    } else if (a === "--help" || a === "-h") {
      console.error(
        "Usage: robin-convert migrate --to v0.2|v0.3 <path-or-glob>... [--vault <root>] [--dry-run] [--check]\n" +
          "\n" +
          "v0.2 migration:\n" +
          '  - removes <script id="robin:frontmatter"> and <script id="robin:blocks">\n' +
          '  - bumps <meta name="robin:version"> to 0.2\n' +
          "\n" +
          "v0.3 migration (chains through v0.2 when needed):\n" +
          "  - adds a globally unique immutable robin:id UUID\n" +
          "  - replaces robin:source with paired robin:source-kind/source-ref tags\n" +
          "  - verifies robin:path relative to --vault (default: current directory)\n" +
          "  - accepts only roots declared by robin/schemas/v1/contract.json\n" +
          "\n" +
          "Both migrations:\n" +
          "  - require exactly one canonical Robin article plus title/slug/type/updated metadata\n" +
          "  - reject generic HTML instead of turning an unrelated artifact into a Robin page\n" +
          "  - reject source versions newer than the requested target\n" +
          "  - preserves the <article> body and all other meta verbatim\n" +
          "  - is idempotent\n" +
          "  - plans only; writes use node robin/scripts/migrate-page.mjs\n" +
          "\n" +
          "Paths may be files, directories (walked recursively for *.html), or simple\n" +
          "globs containing ** or *. Directory runs are strict: unrelated HTML is\n" +
          "reported as failed, so prefer an explicit reviewed file set. Examples:\n" +
          "  robin-convert migrate --to v0.3 brain/risk-register.html --dry-run\n" +
          "  robin-convert migrate --to v0.3 brain out --dry-run\n" +
          '  robin-convert migrate --to v0.3 "brain/**/*.html" --check\n',
      );
      process.exit(0);
    } else if (a?.startsWith("--")) {
      console.error(`[migrate] unknown flag: ${a}`);
      process.exit(2);
    } else if (a) {
      targets.push(a);
    }
  }

  if (to !== "v0.2" && to !== "v0.3") {
    console.error("[migrate] --to must be v0.2 or v0.3");
    process.exit(2);
  }
  if (targets.length === 0) {
    console.error("[migrate] no targets provided");
    process.exit(2);
  }
  if (!dryRun) {
    console.error(
      "[migrate] direct writes are disabled; use the lock/CAS/history-backed " +
        "node robin/scripts/migrate-page.mjs command",
    );
    process.exit(2);
  }
  const missingTargets = targets.filter(
    (target) => !target.includes("*") && !fs.existsSync(target),
  );
  if (missingTargets.length > 0) {
    for (const target of missingTargets) {
      console.error(`[migrate] missing path: ${target}`);
    }
    process.exit(1);
  }

  let vaultRoot: string;
  try {
    vaultRoot = fs.realpathSync(vaultRootArg ?? process.cwd());
    if (!fs.statSync(vaultRoot).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch (error) {
    console.error(`[migrate] invalid vault root: ${(error as Error).message}`);
    process.exit(2);
  }
  let v03PageRoots: string[] = [];
  if (to === "v0.3") {
    try {
      const contract = JSON.parse(
        fs.readFileSync(EXECUTABLE_CONTRACT_PATH, "utf8"),
      ) as ExecutableContract;
      v03PageRoots = executablePageRoots(contract);
    } catch (error) {
      console.error(
        `[migrate] executable page contract cannot be loaded: ${(error as Error).message}`,
      );
      process.exit(2);
    }
  }
  const validateFile = await loadContractValidator();

  const files = collectMigrateTargets(targets);
  if (files.length === 0) {
    console.error("[migrate] no .html files matched");
    process.exit(1);
  }

  let changed = 0;
  let unchanged = 0;
  let failed = 0;

  for (const file of files) {
    try {
      if (fs.lstatSync(file).isSymbolicLink()) {
        throw new Error("migration target must not be a symbolic link");
      }
      const realFile = fs.realpathSync(file);
      const vaultRelativePath = path.relative(vaultRoot, realFile).split(path.sep).join("/");
      if (
        !vaultRelativePath ||
        vaultRelativePath === ".." ||
        vaultRelativePath.startsWith("../") ||
        path.isAbsolute(vaultRelativePath)
      ) {
        throw new Error("migration target must be inside the selected vault root");
      }
      if (to === "v0.3" && !isExecutablePagePath(vaultRelativePath, v03PageRoots)) {
        throw new Error(
          `v0.3 migration target is outside executable page roots (${v03PageRoots.join(", ")}): ${vaultRelativePath}`,
        );
      }
      const html = fs.readFileSync(realFile, "utf8");
      const result =
        to === "v0.2"
          ? migrateV01ToV02(html, { vaultRelativePath })
          : migrateToV03(html, vaultRelativePath);
      const findings = validateFile(`base/${vaultRelativePath}`, result.html);
      if (findings.length > 0) {
        throw new Error(
          `post-migration contract failed: ${findings
            .map((finding) => `${finding.line} ${finding.message}`)
            .join("; ")}`,
        );
      }
      if (!result.changed) {
        unchanged++;
        continue;
      }
      changed++;
      console.log(`[migrate] would update ${file}`);
    } catch (err) {
      failed++;
      console.error(`[migrate] failed ${file}: ${(err as Error).message}`);
    }
  }

  console.error(`\nDone. changed=${changed} unchanged=${unchanged} failed=${failed} (dry-run)`);
  if (failed > 0) process.exit(1);
  if (check && changed > 0) process.exit(1);
}

interface ContractFinding {
  line: number;
  message: string;
}

type ContractValidator = (file: string, contents: string) => ContractFinding[];

async function loadContractValidator(): Promise<ContractValidator> {
  const moduleUrl = new URL("../../../../scripts/validate-data-contract.mjs", import.meta.url);
  const loaded = (await import(moduleUrl.href)) as {
    validateFile?: ContractValidator;
  };
  if (typeof loaded.validateFile !== "function") {
    throw new Error("validate-data-contract.mjs does not export validateFile");
  }
  return loaded.validateFile;
}

function migrateToV03(html: string, vaultRelativePath: string): { html: string; changed: boolean } {
  const version = parseRobinHtmlCore(html).metaMap["robin:version"]?.[0] ?? "0.1";
  if (version === "0.3") return migrateV02ToV03(html, { vaultRelativePath });
  const v02 =
    version === "0.2" ? { html, changed: false } : migrateV01ToV02(html, { vaultRelativePath });
  const v03 = migrateV02ToV03(v02.html, { vaultRelativePath });
  return { html: v03.html, changed: v03.html !== html };
}

/**
 * Expand the user's target list into a concrete set of .html file paths.
 *
 * Supports:
 *   - plain file paths ending in .html
 *   - directories (walked recursively, picking up *.html)
 *   - simple globs with `**` (any depth) and `*` (one segment).
 *     Anchors at the literal portion before the first wildcard.
 *
 * No external glob dependency — keeps the CLI light and predictable.
 */
function collectMigrateTargets(targets: string[]): string[] {
  const out = new Set<string>();
  for (const t of targets) {
    if (t.includes("*")) {
      for (const f of expandGlob(t)) out.add(f);
      continue;
    }
    if (!fs.existsSync(t)) {
      console.error(`[migrate] missing path: ${t}`);
      continue;
    }
    const stat = fs.statSync(t);
    if (stat.isFile()) {
      if (t.endsWith(".html")) out.add(path.resolve(t));
    } else if (stat.isDirectory()) {
      walk(t, (file) => {
        if (file.endsWith(".html")) out.add(path.resolve(file));
      });
    }
  }
  return [...out].sort();
}

function expandGlob(pattern: string): string[] {
  // Split off the literal prefix (everything up to the first wildcard).
  const wildcardIdx = pattern.search(/[*?]/);
  const literal = wildcardIdx > 0 ? pattern.slice(0, wildcardIdx) : ".";
  const literalDir = literal.endsWith("/") ? literal.slice(0, -1) : path.dirname(literal);
  const baseDir = literalDir && fs.existsSync(literalDir) ? literalDir : ".";

  // Convert glob → RegExp.
  //   `**/` spans zero-or-more directory segments (so `brain/**/*.html` matches
  //         both `brain/x.html` and `brain/a/x.html`) → `(?:.*/)?`
  //   `**`  (standalone/trailing) → `.*`
  //   `*`   → any run of non-slash chars → `[^/]*`
  //   `?`   → a single non-slash char → `[^/]`
  // Sentinels (plain ASCII placeholders) keep the multi-step rewrite from clashing.
  const regexSrc =
    "^" +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "@@GLOBSTAR_SLASH@@")
      .replace(/\*\*/g, "@@GLOBSTAR@@")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/@@GLOBSTAR_SLASH@@/g, "(?:.*/)?")
      .replace(/@@GLOBSTAR@@/g, ".*") +
    "$";
  const re = new RegExp(regexSrc);

  const results: string[] = [];
  if (!fs.existsSync(baseDir)) return results;
  walk(baseDir, (file) => {
    if (file.endsWith(".html") && re.test(file)) results.push(path.resolve(file));
  });
  return results;
}

await main();
