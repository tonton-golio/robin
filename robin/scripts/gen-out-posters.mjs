#!/usr/bin/env node
/**
 * Render a poster image for every HTML or video artifact in the vault's out/ tree.
 *
 * Each artifact gets a `<stem>.poster.jpg` sibling. The card grid can display
 * these small images without opening a live document or video for every tile.
 * Posters are generated assets; they are not standalone outputs.
 *
 * Pages are loaded through the running dev server rather than file://, because
 * several of them reference vault media by absolute /api/file/assets/... paths
 * that only resolve over HTTP.
 *
 * Usage:
 *   node robin/scripts/gen-out-posters.mjs [--force] [--base URL] [path ...]
 *
 * Default: every HTML and video under $ROBIN_VAULT/out, including archives.
 * Re-running skips posters newer than their artifact unless --force is passed.
 * Video frames require ffmpeg. Format twins share their HTML sibling's poster.
 */
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const VIDEO = /\.(mp4|webm|mov)$/i;

// Playwright lives in the e2e workspace (robin/app/tests), not beside this
// script, and a bare ESM specifier resolves from the importing FILE — so it is
// resolved explicitly against that workspace rather than by moving the script
// somewhere less obvious.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TESTS_PKG = path.join(HERE, "..", "app", "tests", "package.json");

const VAULT = process.env.ROBIN_VAULT || path.resolve(HERE, "../../base");
const OUT_DIR = path.join(VAULT, "out");

const args = process.argv.slice(2);
const force = args.includes("--force");
const baseIdx = args.indexOf("--base");
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : "http://localhost:8400";
const explicit = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--base");

/** Design width the artifacts are authored against; decks are hard 1280. */
const W = 1280;
const H = 800;
/** Written at half scale — a 640x400 card face, ~30-60 KB per poster. */
const SCALE = 0.5;

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (e.name.endsWith(".html") || VIDEO.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function posterPathFor(abs) {
  return abs.replace(/\.[^.]+$/, ".poster.jpg");
}

async function isFresh(abs, poster) {
  try {
    const [a, p] = await Promise.all([fs.stat(abs), fs.stat(poster)]);
    return p.mtimeMs >= a.mtimeMs;
  } catch {
    return false;
  }
}

const files = explicit.length
  ? explicit.map((p) => (path.isAbsolute(p) ? p : path.resolve(p)))
  : await walk(OUT_DIR);

// No browser (or Playwright installation) is needed for fresh or video-only runs.
let browser;
let page;
async function screenshotPage() {
  if (page) return page;
  const { chromium } = createRequire(TESTS_PKG)("@playwright/test");
  const hasBundledBrowser = await fs.access(chromium.executablePath()).then(() => true, () => false);
  browser = await chromium.launch(hasBundledBrowser ? {} : { channel: "chrome" });
  page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: SCALE,
  });
  return page;
}

let wrote = 0;
let skipped = 0;
const failed = [];

for (const abs of files) {
  const rel = path.relative(VAULT, abs);
  const poster = posterPathFor(abs);
  if (!force && (await isFresh(abs, poster))) {
    skipped += 1;
    continue;
  }
  const url = `${BASE}/api/file/${rel.split(path.sep).map(encodeURIComponent).join("/")}`;
  try {
    if (VIDEO.test(abs)) {
      await runFile("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y", "-i", abs,
        "-vf", "thumbnail=60,scale=640:400:force_original_aspect_ratio=decrease,pad=640:400:(ow-iw)/2:(oh-ih)/2",
        "-frames:v", "1", "-update", "1", poster,
      ], { timeout: 30_000 });
      wrote += 1;
      process.stdout.write(`  poster ${path.relative(OUT_DIR, poster)}\n`);
      continue;
    }
    const page = await screenshotPage();
    const res = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    if (!res || !res.ok()) throw new Error(`HTTP ${res ? res.status() : "no response"}`);
    // Webfonts and inline-SVG charts settle a beat after load; without this the
    // poster catches unstyled text on roughly a third of the decks.
    await page.waitForTimeout(700);
    // The deck runner's own chrome — prev/next arrows, the "1 / 14" counter, the
    // progress bar — is navigation, not the artifact. Baking it into a 640px
    // card face just adds noise the reader cannot act on. Hidden rather than
    // cropped so the cover still fills the frame.
    await page.addStyleTag({
      content: `.nav, .pagenum, .progress, #progress, [class*="progress-bar"] {
        display: none !important; visibility: hidden !important;
      }`,
    });
    await page.waitForTimeout(80);
    await page.screenshot({ path: poster, type: "jpeg", quality: 78 });
    wrote += 1;
    process.stdout.write(`  poster ${path.relative(OUT_DIR, poster)}\n`);
  } catch (err) {
    failed.push(`${rel}: ${err.message}`);
  }
}

await browser?.close();

console.log(`\nwrote ${wrote} · skipped ${skipped} fresh · failed ${failed.length}`);
for (const f of failed) console.log(`  FAILED ${f}`);
process.exit(failed.length > 0 ? 1 : 0);
