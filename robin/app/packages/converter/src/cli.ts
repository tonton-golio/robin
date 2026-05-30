#!/usr/bin/env node
/**
 * Robin converter CLI.
 *
 * Usage:
 *   robin-convert <input.md> [--out <path>] [--vault <root>]
 *   robin-convert --batch <vault-root>
 *   robin-convert migrate --to v0.2 <path-or-glob> [<path-or-glob> ...] [--dry-run] [--check]
 *   echo '...' | robin-convert --stdin --out brain/foo.html
 *
 * In batch mode, recursively converts legacy .md files under `<vault>/brain/`
 * and `<vault>/out/`, writing canonical `.html` siblings next to them.
 * Source .md files are never modified by this command.
 *
 * In migrate mode, transforms existing Robin HTML files from v0.1 → v0.2:
 *   - strips the #robin:frontmatter and #robin:blocks <script> payloads
 *   - bumps the <meta name="robin:version"> to "0.2"
 *   - preserves all other meta, the <article> body, and wikilinks verbatim
 *   - is idempotent (a v0.2 file is left untouched)
 *
 *   --dry-run   Print which files would change without writing.
 *   --check     Exit non-zero if any file would change. Implies --dry-run.
 *
 * SKIPPED files (event streams that stay as markdown):
 *   - logs/changelog.md
 *   - logs/ingest-log.md
 *   - any file whose frontmatter type is `log`
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertMarkdown } from './index.js';
import { migrateV01ToV02 } from './migrations/v0.1-to-v0.2.js';

const SKIP_FILES = new Set(['changelog.md', 'ingest-log.md', 'repo-log.md']);

function usage(): never {
  console.error('Usage: robin-convert <input.md> [--out <path>] [--vault <root>]');
  console.error('       robin-convert --batch <vault-root>');
  console.error('       robin-convert migrate --to v0.2 <path-or-glob>... [--dry-run] [--check]');
  process.exit(2);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  if (args[0] === 'migrate') {
    runMigrate(args.slice(1));
    return;
  }

  if (args[0] === '--batch') {
    const vault = args[1];
    if (!vault) usage();
    batchConvert(vault);
    return;
  }

  if (args[0] === '--stdin') {
    const outFlag = args.indexOf('--out');
    if (outFlag < 0) usage();
    const outPath = args[outFlag + 1];
    if (!outPath) usage();
    const md = fs.readFileSync(0, 'utf8');
    const result = convertMarkdown(md, { outputPath: outPath });
    process.stdout.write(result.html);
    return;
  }

  // Single-file mode
  const inputPath = args[0];
  if (!inputPath) usage();
  const outFlag = args.indexOf('--out');
  const vaultFlag = args.indexOf('--vault');
  const md = fs.readFileSync(inputPath, 'utf8');

  let outputPath: string;
  if (outFlag >= 0 && args[outFlag + 1]) {
    outputPath = args[outFlag + 1]!;
  } else if (vaultFlag >= 0 && args[vaultFlag + 1]) {
    outputPath = path.relative(args[vaultFlag + 1]!, inputPath).replace(/\.md$/, '.html');
  } else {
    outputPath = path.basename(inputPath).replace(/\.md$/, '.html');
  }

  const stat = fs.statSync(inputPath);
  const result = convertMarkdown(md, { outputPath, updated: stat.mtime });
  process.stdout.write(result.html);

  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.error(`[warn] ${w}`);
  }
}

function batchConvert(vaultRoot: string) {
  const sourceTargets = ['brain', 'out'];
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
      if (!file.endsWith('.md')) return;
      const base = path.basename(file);
      if (SKIP_FILES.has(base)) {
        skipped++;
        return;
      }
      const relFromVault = path.relative(vaultRoot, file); // e.g. "brain/_index.html" during legacy migration
      const htmlRel = relFromVault.replace(/\.md$/, '.html');
      const outAbs = path.join(vaultRoot, htmlRel);

      try {
        const md = fs.readFileSync(file, 'utf8');
        // Quick log-type check: if frontmatter contains `type: log`, skip.
        if (/^---[\s\S]*?\btype:\s*log\b/.test(md.slice(0, 1000))) {
          skipped++;
          return;
        }
        const stat = fs.statSync(file);
        const result = convertMarkdown(md, { outputPath: htmlRel, updated: stat.mtime });
        fs.mkdirSync(path.dirname(outAbs), { recursive: true });
        fs.writeFileSync(outAbs, result.html, 'utf8');
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
  console.error('HTML written next to legacy source .md files (source files untouched)');
}

function walk(dir: string, fn: (file: string) => void) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, fn);
    else if (entry.isFile()) fn(full);
  }
}

// ── migrate subcommand ──────────────────────────────────────────────────────

function runMigrate(args: string[]) {
  // Parse flags + positional paths.
  let to: string | null = null;
  let dryRun = false;
  let check = false;
  const targets: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--to') {
      to = args[++i] ?? null;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--check') {
      check = true;
      dryRun = true;
    } else if (a === '--help' || a === '-h') {
      console.error(
        'Usage: robin-convert migrate --to v0.2 <path-or-glob>... [--dry-run] [--check]\n' +
          '\n' +
          'Migrates Robin HTML pages from v0.1 to v0.2:\n' +
          '  - removes <script id="robin:frontmatter"> and <script id="robin:blocks">\n' +
          '  - bumps <meta name="robin:version"> to 0.2\n' +
          '  - preserves the <article> body and all other meta verbatim\n' +
          '  - is idempotent (v0.2 inputs are left untouched)\n' +
          '\n' +
          'Paths may be files, directories (walked recursively for *.html), or simple\n' +
          'globs containing ** or *. Examples:\n' +
          '  robin-convert migrate --to v0.2 brain/risk-register.html\n' +
          '  robin-convert migrate --to v0.2 brain out\n' +
          '  robin-convert migrate --to v0.2 "brain/**/*.html" --dry-run\n',
      );
      process.exit(0);
    } else if (a && a.startsWith('--')) {
      console.error(`[migrate] unknown flag: ${a}`);
      process.exit(2);
    } else if (a) {
      targets.push(a);
    }
  }

  if (to !== 'v0.2') {
    console.error('[migrate] only --to v0.2 is supported in this release');
    process.exit(2);
  }
  if (targets.length === 0) {
    console.error('[migrate] no targets provided');
    process.exit(2);
  }

  const files = collectMigrateTargets(targets);
  if (files.length === 0) {
    console.error('[migrate] no .html files matched');
    process.exit(check ? 1 : 0);
  }

  let changed = 0;
  let unchanged = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const html = fs.readFileSync(file, 'utf8');
      const result = migrateV01ToV02(html);
      if (!result.changed) {
        unchanged++;
        continue;
      }
      changed++;
      if (dryRun) {
        console.log(`[migrate] would update ${file}`);
      } else {
        const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmp, result.html, 'utf8');
        fs.renameSync(tmp, file);
        console.log(`[migrate] updated ${file}`);
      }
    } catch (err) {
      failed++;
      console.error(`[migrate] failed ${file}: ${(err as Error).message}`);
    }
  }

  console.error(
    `\nDone. changed=${changed} unchanged=${unchanged} failed=${failed} (${dryRun ? 'dry-run' : 'wrote files'})`,
  );
  if (failed > 0) process.exit(1);
  if (check && changed > 0) process.exit(1);
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
    if (t.includes('*')) {
      for (const f of expandGlob(t)) out.add(f);
      continue;
    }
    if (!fs.existsSync(t)) {
      console.error(`[migrate] missing path: ${t}`);
      continue;
    }
    const stat = fs.statSync(t);
    if (stat.isFile()) {
      if (t.endsWith('.html')) out.add(path.resolve(t));
    } else if (stat.isDirectory()) {
      walk(t, (file) => {
        if (file.endsWith('.html')) out.add(path.resolve(file));
      });
    }
  }
  return [...out].sort();
}

function expandGlob(pattern: string): string[] {
  // Split off the literal prefix (everything up to the first wildcard).
  const wildcardIdx = pattern.search(/[*?]/);
  const literal = wildcardIdx > 0 ? pattern.slice(0, wildcardIdx) : '.';
  const literalDir = literal.endsWith('/') ? literal.slice(0, -1) : path.dirname(literal);
  const baseDir = literalDir && fs.existsSync(literalDir) ? literalDir : '.';

  // Convert glob → RegExp.
  //   `**/` spans zero-or-more directory segments (so `brain/**/*.html` matches
  //         both `brain/x.html` and `brain/a/x.html`) → `(?:.*/)?`
  //   `**`  (standalone/trailing) → `.*`
  //   `*`   → any run of non-slash chars → `[^/]*`
  //   `?`   → a single non-slash char → `[^/]`
  // Sentinels (plain ASCII placeholders) keep the multi-step rewrite from clashing.
  const regexSrc =
    '^' +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '@@GLOBSTAR_SLASH@@')
      .replace(/\*\*/g, '@@GLOBSTAR@@')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/@@GLOBSTAR_SLASH@@/g, '(?:.*/)?')
      .replace(/@@GLOBSTAR@@/g, '.*') +
    '$';
  const re = new RegExp(regexSrc);

  const results: string[] = [];
  if (!fs.existsSync(baseDir)) return results;
  walk(baseDir, (file) => {
    if (file.endsWith('.html') && re.test(file)) results.push(path.resolve(file));
  });
  return results;
}

main();
