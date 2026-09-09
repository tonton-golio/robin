/**
 * Derivation for the /outputs ledger.
 *
 * Server-only. Everything here answers one of the page's four questions —
 * who was it for, what is it, is it still current, what happens when I click —
 * from facts that are actually on disk. Every function returns an explicit
 * "absent" value; none returns a guess. Where Robin infers rather than quotes
 * (contributor dashboards, scope grouping) the view model carries the grade so
 * the UI can render inference differently from quotation.
 *
 * Cost: one read + one hast parse per out/ HTML file, memoised at module scope
 * on `path:mtimeMs`. The page is force-dynamic, so without that cache every
 * request would re-parse ~1 MB. Extra I/O beyond the cache miss is one readdir
 * per out/ subdirectory (poster siblings), one head-read of the single .md, and
 * one read of the annotation jsonl.
 */

import fs from "fs/promises";
import { matchesName } from "@/lib/owner-identity";
import type { EditEvent } from "@robin/vault-io";
import type { Element, ElementContent, Root, RootContent, Text } from "hast";
import { fromHtml } from "hast-util-from-html";
import path from "path";
import type { OutputItem } from "@/lib/catalog";
import { readEditEvents } from "@/lib/edit-store";
import { resolveMovedHtmlPathFromEvents } from "@/lib/moved-path";
import { vaultApiFileHref, vaultFileHref, vaultPageHref } from "@/lib/routes";
import { locateVault } from "@/lib/vault";
import type {
  CensusEntry,
  CensusKey,
  Entry,
  FlagView,
  GroupView,
  LedgerData,
  OutputView,
  PeekPreview,
  Recipient,
  Scope,
  SeriesView,
} from "./types";

// Absolute dates are pinned to UTC so the server-rendered strings that cross to
// the client component are deterministic (any tz drift = hydration mismatch).
const DAY_FMT = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" });
const MINUTE_FMT = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** Widest string the FOR gutter shows without the browser ellipsing it. */
const FOR_WIDTH = 13;
/** Raw-source lines shown in peek for the one .md artifact. */
const MD_PEEK_LINES = 40;

const VIDEO_RE = /\.(mp4|m4v|mov|ogv|webm)$/i;

// ── hast helpers ────────────────────────────────────────────────────────────

function isElement(node: RootContent | ElementContent): node is Element {
  return node.type === "element";
}

function walk(node: Root | Element, visit: (el: Element) => void): void {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    visit(child);
    walk(child, visit);
  }
}

function classesOf(el: Element): string[] {
  const raw = el.properties?.["className"];
  if (Array.isArray(raw)) return raw.map((c) => String(c));
  if (typeof raw === "string") return raw.split(/\s+/);
  return [];
}

function hasClass(el: Element, name: string): boolean {
  return classesOf(el).includes(name);
}

function textOf(node: Element | Text | RootContent | ElementContent): string {
  if (node.type === "text") return (node as Text).value;
  if (node.type !== "element") return "";
  return (node as Element).children.map((c) => textOf(c)).join("");
}

function cleanText(node: Element): string {
  return textOf(node).replace(/\s+/g, " ").trim();
}

/** Every element in document order, so "before the first h1" is answerable. */
function elementsInOrder(root: Root): Element[] {
  const out: Element[] = [];
  walk(root, (el) => out.push(el));
  return out;
}

// ── the per-file parse (memoised) ───────────────────────────────────────────

export interface CoverFacts {
  /** First <title> — the parse.ts last-title-wins bug never reaches this page. */
  firstTitle?: string;
  /** First <h1>, the most reliable human title in out/. */
  firstH1?: string;
  meta: Record<string, string[]>;
  slideCount: number;
  /** True for `<article data-robin-doc>` pages — the reader strips their <style>. */
  hasArticle: boolean;
  recipient?: { quote: string; source: string };
  archived?: { date: string; successor?: string };
  /** Relative <img src> values, for the broken-asset check. */
  relImages: string[];
  /** Vault paths this document names in its own <code> (outside the banner). */
  namedPaths: string[];
  /** A literal handling sentence the document writes about itself. */
  handling?: { label: string; quote: string };
}

interface CacheEntry {
  mtimeMs: number;
  facts: CoverFacts;
}

const factCache = new Map<string, CacheEntry>();

function metaMapOf(root: Root): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  walk(root, (el) => {
    if (el.tagName !== "meta") return;
    const name = el.properties?.["name"];
    const content = el.properties?.["content"];
    if (typeof name !== "string" || !name.startsWith("robin:") || content === undefined) return;
    (map[name] ??= []).push(content === null ? "" : String(content));
  });
  return map;
}

/**
 * Recipient extraction, node-scoped only.
 *
 * A first-1500-chars regex for /(prepared )?for\s+[A-Z]/ is rejected: verified
 * noisy on this corpus ("that last exercise can't be prepared for" sits deep in
 * hiring-pipeline-report.html). Two scopes are allowed instead:
 *
 *  1. decks — inside `section.slide.cover`, preferring `.eyebrow`;
 *  2. reports — elements before the first <h1>, plus that <h1>'s own container
 *     (plan-sept-*.html put `p.audience` *after* the h1 inside `div.cover`).
 *
 * Among matches, the most specific one wins (an ancestor whose match comes from
 * a descendant is discarded), so `div.meta > span` beats `div.meta`.
 */
/*
 * The addressee shape, verified against every file in out/: "for" (optionally
 * "prepared for") must open the string or follow a "·" separator. A bare \bfor\b
 * is far too loose — it fires on "Transport for London" in a budget table, on
 * "the AI nerd in their friend group" in the hiring record, and on "right call
 * for September scope" in a week-in-review. All three sat in the candidate set
 * and all three would have been printed as recipients.
 */
const FOR_RE = /(?:^|[·|])\s*(?:[Pp]repared\s+)?[Ff]or:?\s+(?:the\s+)?[A-Z]/;

/** How far around the first <h1> the report scan may look, in sibling blocks. */
const COVER_WINDOW = 6;
/** How many elements immediately before the first <h1> the scan may look at. */
const BEFORE_WINDOW = 10;

function pickRecipientNode(candidates: Element[]): Element | undefined {
  const matches = candidates.filter((el) => {
    const t = cleanText(el);
    return t.length > 0 && t.length <= 200 && FOR_RE.test(t);
  });
  // Drop any match that merely contains another match — keep the tightest node.
  return matches.find((el) => !matches.some((other) => other !== el && isDescendant(el, other)));
}

function isDescendant(ancestor: Element, node: Element): boolean {
  let found = false;
  walk(ancestor, (el) => {
    if (el === node) found = true;
  });
  return found;
}

function recipientFacts(root: Root): { quote: string; source: string } | undefined {
  const all = elementsInOrder(root);

  // 1. Deck cover.
  const cover = all.find((el) => hasClass(el, "slide") && hasClass(el, "cover"));
  if (cover) {
    const inCover: Element[] = [];
    walk(cover, (el) => inCover.push(el));
    const eyebrow = inCover.find((el) => hasClass(el, "eyebrow"));
    if (eyebrow && FOR_RE.test(cleanText(eyebrow))) {
      return { quote: cleanText(eyebrow), source: "section.slide.cover .eyebrow" };
    }
    const other = pickRecipientNode(inCover);
    if (other) return { quote: cleanText(other), source: "section.slide.cover" };
    return undefined;
  }

  // 2. Report cover block.
  const h1Index = all.findIndex((el) => el.tagName === "h1");
  if (h1Index < 0) return undefined;
  const h1 = all[h1Index];
  if (!h1) return undefined;
  const container = all.find((el) => el !== h1 && directChildren(el).includes(h1));
  const before = all.slice(Math.max(0, h1Index - BEFORE_WINDOW), h1Index);
  // Only the sibling blocks around the <h1>, not the container's whole subtree:
  // for several artifacts the h1's parent is <main>, and walking it would be the
  // document-wide scan this extractor exists to avoid.
  const inContainer: Element[] = [];
  if (container) {
    const kids = directChildren(container);
    const at = kids.indexOf(h1);
    for (const kid of kids.slice(Math.max(0, at - COVER_WINDOW), at + COVER_WINDOW + 1)) {
      if (kid === h1) continue;
      inContainer.push(kid);
      walk(kid, (el) => inContainer.push(el));
    }
  }
  const node = pickRecipientNode([...before, ...inContainer]);
  if (!node) return undefined;
  return {
    quote: cleanText(node),
    source: container ? "the cover block" : "the block before <h1>",
  };
}

function directChildren(el: Element): Element[] {
  return el.children.filter(isElement);
}

/** The `Archived YYYY-MM-DD — …` banner, plus the out/ path it names, if any. */
function archiveFacts(root: Root): { date: string; successor?: string } | undefined {
  const all = elementsInOrder(root);
  const banner = all.find((el) => {
    if (el.tagName !== "blockquote" && el.tagName !== "p" && el.tagName !== "div") return false;
    return /^Archived \d{4}-\d{2}-\d{2}\b/.test(cleanText(el));
  });
  if (!banner) return undefined;
  const date = /^Archived (\d{4}-\d{2}-\d{2})/.exec(cleanText(banner))?.[1] ?? "";
  // Only an out/ path counts as a successor. Codes naming brain/ pages are
  // "where the durable facts went", which is a different claim.
  let successor: string | undefined;
  walk(banner, (el) => {
    if (successor || el.tagName !== "code") return;
    const t = cleanText(el);
    if (t.startsWith("out/")) successor = t;
  });
  return { date, successor };
}

/** Handling sentences the document writes about itself, quoted back verbatim. */
function handlingFacts(root: Root): { label: string; quote: string } | undefined {
  let hit: { label: string; quote: string } | undefined;
  walk(root, (el) => {
    if (hit) return;
    if (directChildren(el).length > 2) return;
    const t = cleanText(el);
    if (t.length > 400) return;
    if (/not a shareable artifact/i.test(t)) hit = { label: "do not send", quote: t };
    else if (/for your own eyes/i.test(t)) hit = { label: "own eyes only", quote: t };
  });
  return hit;
}

export function parseFacts(html: string): CoverFacts {
  const root = fromHtml(html, { fragment: false }) as Root;
  const all = elementsInOrder(root);

  const titleEl = all.find((el) => el.tagName === "title");
  const h1El = all.find((el) => el.tagName === "h1");
  const slideCount = all.filter((el) => el.tagName === "section" && hasClass(el, "slide")).length;
  const hasArticle = all.some(
    (el) => el.tagName === "article" && !!el.properties && "dataRobinDoc" in el.properties,
  );

  const relImages: string[] = [];
  for (const el of all) {
    if (el.tagName !== "img") continue;
    const src = el.properties?.["src"];
    if (typeof src !== "string" || !src) continue;
    if (/^(https?:|data:|\/)/i.test(src)) continue; // app- or network-served: not ours to stat
    if (!relImages.includes(src)) relImages.push(src);
  }

  const archived = archiveFacts(root);
  const namedPaths: string[] = [];
  for (const el of all) {
    if (el.tagName !== "code") continue;
    const t = cleanText(el);
    if (!/^[\w./-]+\.(html|pptx|mp4)$/.test(t)) continue;
    if (archived?.successor === t) continue;
    if (!namedPaths.includes(t)) namedPaths.push(t);
  }

  const facts: CoverFacts = {
    meta: metaMapOf(root),
    slideCount,
    hasArticle,
    relImages,
    namedPaths,
  };
  if (titleEl) facts.firstTitle = cleanText(titleEl);
  if (h1El) facts.firstH1 = cleanText(h1El);
  const recipient = recipientFacts(root);
  if (recipient) facts.recipient = recipient;
  if (archived) facts.archived = archived;
  const handling = handlingFacts(root);
  if (handling) facts.handling = handling;
  return facts;
}

async function factsFor(
  vault: string,
  relPath: string,
  mtimeMs: number,
): Promise<CoverFacts | null> {
  const hit = factCache.get(relPath);
  if (hit && hit.mtimeMs === mtimeMs) return hit.facts;
  try {
    const html = await fs.readFile(path.join(vault, relPath), "utf-8");
    const facts = parseFacts(html);
    factCache.set(relPath, { mtimeMs, facts });
    return facts;
  } catch {
    return null;
  }
}

// ── recipient → gutter string ───────────────────────────────────────────────

/** Trailing "· July 2026" / "· as of 1 Jul 2026" segments are dates, not people. */
function isDateSegment(seg: string): boolean {
  return /\d{4}/.test(seg) || /^as of\b/i.test(seg);
}

function shortenName(seg: string): string {
  if (seg.includes("&")) return seg;
  const m = /^([A-Z][\p{L}'’-]+)\s+[A-Z][\p{L}'’-]+/u.exec(seg);
  return m?.[1] ?? seg;
}

/**
 * Reduce a quoted addressee sentence to what the 13ch FOR gutter can print.
 *
 * Returns undefined when the tail is longer than a name list plausibly is —
 * an addressee is "Board & Finance", not half a sentence. Without that ceiling a
 * summary like "Club flyer for the coordinator's noticeboard — welcoming…"
 * would be printed as if the whole clause were the recipient.
 */
const FOR_MAX = 40;

export function gutterFrom(quote: string): string | undefined {
  const m = /\bfor:?\s+(.+)$/i.exec(quote);
  if (!m?.[1]) return undefined;
  const segments = m[1]
    .split("·")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isDateSegment(s));
  if (segments.length === 0) return undefined;
  let text = segments.join(" · ").replace(/^the\s+/i, "");
  if (text.length > FOR_WIDTH)
    text = segments
      .map(shortenName)
      .join(" · ")
      .replace(/^the\s+/i, "");
  text = text.replace(/[.,;]$/, "");
  return text.length > FOR_MAX ? undefined : text;
}

/** Contributor dashboards name their subject in the <h1>: "Jordan Lee — …". */
export function inferredSubject(title: string): string | undefined {
  const m = /^([A-Z][\p{L}'’-]+)(?:\s+[A-Z][\p{L}'’-]+)*\s+[—–-]\s+/u.exec(title);
  const first = m?.[1];
  if (!first) return undefined;
  // Only a person-shaped subject, never an initialism or product name.
  if (first.length < 3 || first === first.toUpperCase()) return undefined;
  return first;
}

export function recipientOf(facts: CoverFacts | null, summary?: string): Recipient {
  if (facts?.recipient) {
    const text = gutterFrom(facts.recipient.quote);
    if (text) {
      return {
        text,
        quote: facts.recipient.quote,
        source: facts.recipient.source,
        grade: "quoted",
      };
    }
  }
  if (summary && FOR_RE.test(summary)) {
    const text = gutterFrom(summary);
    if (text) return { text, quote: summary, source: "robin:summary", grade: "quoted" };
  }
  return { text: "", grade: "none" };
}

// ── scope ───────────────────────────────────────────────────────────────────

const OUTSIDE_RE = /\b(customer|client|external)\b/i;
const BOARD_RE = /\b(board|c-level|exec|executive|leadership|finance)\b/i;

export function scopeOf(recipient: Recipient, archived: boolean, ownerOnly: boolean, config = {
  owner: process.env.ROBIN_OWNER ?? '',
  external: (process.env.ROBIN_EXTERNAL_RECIPIENTS ?? '').split(',').map(name => name.trim()).filter(Boolean),
  leadership: (process.env.ROBIN_LEADERSHIP_RECIPIENTS ?? '').split(',').map(name => name.trim()).filter(Boolean),
}): Scope {
  if (archived) return "archived";
  if (ownerOnly) return "human";
  if (recipient.grade === "none") return "unstated";
  if (matchesName(recipient.text, config.owner) || /^(owner|you|human)\b/i.test(recipient.text)) return "human";
  if (OUTSIDE_RE.test(recipient.text) || config.external.some(name => matchesName(recipient.text, name))) return "outside";
  if (BOARD_RE.test(recipient.text) || config.leadership.some(name => matchesName(recipient.text, name))) return "board";
  return "team";
}

/** Archive directories are an explicit lifecycle signal, regardless of file metadata. */
export function isArchivedPath(relPath: string): boolean {
  return relPath
    .split(/[\\/]+/)
    .some((segment) => ["archive", "archives", "archived"].includes(segment.toLowerCase()));
}

const SCOPE_LABEL: Record<Scope, string> = {
  outside: "External recipients",
  board: "Board & leadership",
  team: "Team & internal",
  human: "Private",
  unstated: "No recipient stated",
  archived: "Archived",
};

const SCOPE_ORDER: Scope[] = ["outside", "board", "team", "human", "unstated", "archived"];

// ── annotations ─────────────────────────────────────────────────────────────

interface AnnotationTally {
  /** page_path → distinct annotation ids. */
  byPath: Map<string, Set<string>>;
  /** page_path → raw event count, for the orphan footer. */
  eventsByPath: Map<string, number>;
}

export async function reassociateMovedAnnotations(
  tally: AnnotationTally,
  knownPaths: Set<string>,
  editEvents: EditEvent[],
): Promise<AnnotationTally> {
  const byPath = new Map(Array.from(tally.byPath, ([key, ids]) => [key, new Set(ids)]));
  const eventsByPath = new Map(tally.eventsByPath);

  for (const oldPath of new Set([...byPath.keys(), ...eventsByPath.keys()])) {
    if (knownPaths.has(oldPath)) continue;
    const currentPath = await resolveMovedHtmlPathFromEvents(
      oldPath,
      editEvents,
      async (candidate) => knownPaths.has(candidate),
    );
    if (!currentPath) continue;

    const oldIds = byPath.get(oldPath);
    if (oldIds) {
      const currentIds = byPath.get(currentPath) ?? new Set<string>();
      for (const id of oldIds) currentIds.add(id);
      byPath.set(currentPath, currentIds);
      byPath.delete(oldPath);
    }
    const oldEvents = eventsByPath.get(oldPath) ?? 0;
    eventsByPath.set(currentPath, (eventsByPath.get(currentPath) ?? 0) + oldEvents);
    eventsByPath.delete(oldPath);
  }

  return { byPath, eventsByPath };
}

/** Cached on the jsonl set's own mtimes: the page is force-dynamic, and the log
 *  is ~64 KB of JSON that changes only when someone annotates something. A few
 *  stats are cheaper than the re-read + re-parse, and they cannot go stale. */
let annotationCache: { stamp: string; tally: AnnotationTally } | null = null;

async function readAnnotations(vault: string): Promise<AnnotationTally> {
  const dir = path.join(vault, "inbox", "robin", "annotations");
  const tally: AnnotationTally = { byPath: new Map(), eventsByPath: new Map() };
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return tally;
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => path.join(dir, e.name))
    .sort();

  const stamps = await Promise.all(
    files.map(async (f) => {
      const st = await fs.stat(f).catch(() => null);
      return `${f}:${st?.mtimeMs ?? 0}:${st?.size ?? 0}`;
    }),
  );
  const stamp = stamps.join("|");
  if (annotationCache && annotationCache.stamp === stamp) return annotationCache.tally;

  for (const file of files) {
    const content = await fs.readFile(file, "utf-8").catch(() => "");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let event: { id?: string; page_path?: string };
      try {
        // One line in 2026-06.jsonl is malformed (two concatenated objects).
        // Skip it rather than dropping the whole month, as edit-store does.
        event = JSON.parse(line) as { id?: string; page_path?: string };
      } catch {
        continue;
      }
      const pagePath = event.page_path;
      if (!pagePath || !pagePath.startsWith("out/")) continue;
      const set = tally.byPath.get(pagePath) ?? new Set<string>();
      set.add(event.id ?? line);
      tally.byPath.set(pagePath, set);
      tally.eventsByPath.set(pagePath, (tally.eventsByPath.get(pagePath) ?? 0) + 1);
    }
  }
  annotationCache = { stamp, tally };
  return tally;
}

// ── extent + render path ────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function extOf(relPath: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(relPath);
  return m?.[1] ? m[1].toLowerCase() : "";
}

/**
 * The real title: the FIRST <title>, else the first <h1>, else the catalog's
 * de-hyphenated filename. Taking the first <title> is the whole local defence
 * against the last-<title>-wins bug in packages/converter (reported, not patched
 * here): the values that collide are inline-SVG chart tooltips, always later in
 * the document. <h1> is the fallback rather than the lead because a deck's h1 is
 * its cover headline ("Example Automation") while its <title> is its name.
 */
export function titleOf(
  facts: CoverFacts | null,
  mdTitle: string | undefined,
  fallback: string,
): string {
  return mdTitle ?? (facts?.firstTitle || facts?.firstH1 || fallback);
}

/**
 * State: `robin:state` (legacy, most of out/) OR `robin:status` (canonical).
 * Absent → UNSTATED, never a defaulted "current". The single most important
 * degradation rule on the page, so it is its own function and its own test.
 */
export function stateOf(meta: Record<string, string[]>): { state: string; source?: string } {
  const legacy = meta["robin:state"]?.[0];
  if (legacy) return { state: legacy.toUpperCase(), source: "robin:state" };
  const canonical = meta["robin:status"]?.[0];
  if (canonical) return { state: canonical.toUpperCase(), source: "robin:status" };
  return { state: "UNSTATED" };
}

export interface ExtentInput {
  relPath: string;
  ext: string;
  size: number;
  slides: number;
  /** Set only for the one .md artifact. */
  mdLines?: number;
}

/** Extent, never a byte count except where bytes are the honest measure. */
export function extentOf(input: ExtentInput): { extent: string; extentShort: string } {
  if (VIDEO_RE.test(input.relPath)) {
    const label = `Video · ${formatBytes(input.size)}`;
    return { extent: label, extentShort: label };
  }
  if (input.ext === "pptx") {
    const label = `PPTX · ${formatBytes(input.size)}`;
    return { extent: label, extentShort: label };
  }
  if (input.mdLines !== undefined) {
    return { extent: `MD · ${input.mdLines} lines`, extentShort: `MD · ${input.mdLines}` };
  }
  if (input.slides > 0) {
    return { extent: `Deck · ${input.slides} slides`, extentShort: `Deck · ${input.slides}` };
  }
  if (input.relPath.startsWith("out/presentations/")) {
    return { extent: "Diagram · 1 page", extentShort: "Diagram" };
  }
  return { extent: "Doc · 1 page", extentShort: "Doc" };
}

/**
 * The handling flag. A literal sentence the document writes about itself beats
 * the `sensitive` tag, because it can be quoted back. Absence of the flag is not
 * a claim that something is shareable.
 */
export function handlingFlagOf(
  handling: CoverFacts["handling"],
  tags: string[],
): FlagView | undefined {
  if (handling) {
    return {
      key: "handling",
      glyph: "◈",
      label: handling.label,
      title: `The document says so itself: “${handling.quote}”`,
      tone: "warn",
    };
  }
  if (tags.some((t) => t.toLowerCase() === "sensitive")) {
    return {
      key: "sensitive",
      glyph: "◈",
      label: "sensitive",
      title: "robin:tags on this file contains “sensitive”.",
      tone: "warn",
    };
  }
  return undefined;
}

export interface SeriesInput {
  path: string;
  dir: string;
  mtime: Date;
  ext: string;
  /** Derived before series inference so unrelated audiences cannot be grouped. */
  scope?: Scope;
  /** Archived artifacts are terminal rows and never members of inferred deliverables. */
  archived?: boolean;
}

/**
 * Series detection, deterministic and printed on the card.
 *
 *  - generator batch — same directory, identical mtime minute, ≥3 members, and
 *    the directory is NOT archive/. That exclusion is load-bearing: the seven
 *    archive files were bulk-touched inside one window by the archive move, and
 *    a rule keyed on batch timestamps would manufacture a phantom deliverable
 *    out of a filesystem operation.
 *  - sibling cuts — same directory, 2–3 files, one extension, nothing else in
 *    the directory.
 */
export function seriesOf(entries: SeriesInput[]): SeriesView[] {
  const series: SeriesView[] = [];
  const claimed = new Set<string>();

  const byMinute = new Map<string, SeriesInput[]>();
  for (const e of entries) {
    if (e.archived || e.dir.includes("/archive")) continue;
    const key = `${e.dir}|${MINUTE_FMT.format(e.mtime)}|${e.scope ?? "unstated"}`;
    byMinute.set(key, [...(byMinute.get(key) ?? []), e]);
  }
  for (const [key, members] of byMinute) {
    if (members.length < 3) continue;
    const first = members[0];
    if (!first) continue;
    series.push({
      id: `batch:${key}`,
      scope: "unstated",
      label: `${first.dir}/ · one generator run`,
      note: `${members.length} files · same directory, identical mtime minute · ${MINUTE_FMT.format(first.mtime)}`,
      members: members.map((m) => m.path),
    });
    for (const m of members) claimed.add(m.path);
  }

  const byDir = new Map<string, SeriesInput[]>();
  for (const e of entries) {
    if (e.archived) continue;
    const key = `${e.dir}|${e.scope ?? "unstated"}`;
    byDir.set(key, [...(byDir.get(key) ?? []), e]);
  }
  for (const members of byDir.values()) {
    const dir = members[0]?.dir;
    if (!dir) continue;
    if (dir === "out" || dir.includes("/archive")) continue;
    if (members.length < 2 || members.length > 3) continue;
    if (members.some((m) => claimed.has(m.path))) continue;
    if (new Set(members.map((m) => m.ext)).size !== 1) continue;
    const first = members[0];
    if (!first) continue;
    series.push({
      id: `cuts:${dir}${members[0]?.scope ? `:${members[0].scope}` : ""}`,
      scope: "unstated",
      label: path.basename(dir).replace(/[-_]+/g, " "),
      note: `${members.length} cuts · same directory, same format · ${DAY_FMT.format(first.mtime)}`,
      caveat: "Nothing on disk records which cut shipped.",
      members: members.map((m) => m.path),
    });
    for (const m of members) claimed.add(m.path);
  }

  return series;
}

// ── the deriver ─────────────────────────────────────────────────────────────

export interface EditInfo {
  saves: number;
  lastMs: number;
  /** The recorded actor string, verbatim. `deck-editor` identifies the editor software. */
  actor: string;
}

interface Draft {
  item: OutputItem;
  view: OutputView;
  dir: string;
}

export async function deriveLedger(
  outputs: OutputItem[],
  editInfo: Map<string, EditInfo>,
): Promise<LedgerData> {
  const vault = locateVault();
  const [rawAnnotations, siblings, editEvents] = await Promise.all([
    readAnnotations(vault),
    listSiblings(vault, outputs),
    readEditEvents(),
  ]);

  const known = new Set(outputs.map((o) => o.path));
  const annotations = await reassociateMovedAnnotations(rawAnnotations, known, editEvents);
  const basenames = new Map<string, string>();
  for (const o of outputs) basenames.set(path.basename(o.path), o.path);

  // Per-file work is independent, so it runs as one Promise.all instead of a
  // serial await chain: the cost stays O(1) round trips as out/ grows.
  const drafts: Draft[] = await Promise.all(
    outputs.map(async (item): Promise<Draft> => {
      const ext = extOf(item.path);
      const mtimeMs = item.mtime.getTime();
      const facts = ext === "html" ? await factsFor(vault, item.path, mtimeMs) : null;
      const mdHead = ext === "md" ? await readHead(vault, item.path, mtimeMs) : null;
      const dir = path.dirname(item.path);

      const title = titleOf(facts, mdHead?.title, item.title);

      const meta = facts?.meta ?? {};
      const summary = meta["robin:summary"]?.[0];
      const tags = [
        ...(meta["robin:tag"] ?? []),
        ...(meta["robin:tags"]?.[0]?.split(",").map((t) => t.trim()) ?? []),
      ].filter(Boolean);

      const { state, source: stateSource } = stateOf(meta);

      const recipient = recipientOf(facts, summary);
      const handling = facts?.handling;
      const archived = state === "ARCHIVED" || !!facts?.archived || isArchivedPath(item.path);
      const scope = scopeOf(recipient, archived, !!handling);

      const { extent, extentShort } = extentOf({
        relPath: item.path,
        ext,
        size: item.size,
        slides: facts?.slideCount ?? 0,
        ...(mdHead ? { mdLines: mdHead.lines } : {}),
      });

      // ── what the reader will actually do with this file.
      const flags: FlagView[] = [];
      let opensAs: string;
      let preview: PeekPreview;
      if (ext === "html" && facts?.hasArticle) {
        opensAs = "reader view — this file’s own <style> is stripped";
        flags.push({
          key: "unstyled",
          glyph: "⟂",
          label: "unstyled",
          title:
            "Opens through the reader, which strips this file’s <style>: it will not look like the document.",
        });
        preview = { kind: "iframe", src: vaultApiFileHref(item.path) };
      } else if (ext === "html") {
        opensAs = "standalone artifact, full fidelity";
        preview = { kind: "iframe", src: vaultApiFileHref(item.path) };
      } else if (mdHead) {
        opensAs = "raw markdown source in a <pre> — no renderer exists";
        flags.push({
          key: "raw-md",
          glyph: "⟂",
          label: "raw markdown",
          title: "Opens as a raw markdown source dump; the /file route has no markdown renderer.",
        });
        preview = {
          kind: "text",
          text: mdHead.head,
          note: `raw source, first ${MD_PEEK_LINES} lines`,
        };
      } else if (VIDEO_RE.test(item.path)) {
        opensAs = "inline video player";
        preview = { kind: "video", src: vaultApiFileHref(item.path) };
      } else {
        opensAs = "download only — no inline viewer for this format";
        flags.push({
          key: "download",
          glyph: "⟂",
          label: "downloads only",
          title: "No inline viewer for this format; opening it downloads the file.",
        });
        preview = { kind: "none", note: `no inline preview exists for .${ext}` };
      }

      // A rendered poster next to the artifact beats any generated placeholder.
      const poster = siblings.posters.get(stripExt(item.path));
      if (poster) preview = preview.kind === "video"
        ? { ...preview, poster: vaultApiFileHref(poster) }
        : { kind: "poster", poster: vaultApiFileHref(poster) };

      // ── broken assets, stated as a count of what could not be found.
      const missing = await countMissing(vault, dir, facts?.relImages ?? []);
      if (missing > 0) {
        flags.push({
          key: "missing-images",
          glyph: "⟂",
          label: `${missing} image${missing === 1 ? "" : "s"} missing`,
          title: `${missing} <img> reference${missing === 1 ? "" : "s"} in this file point at files that are not on disk.`,
        });
      }

      const handlingFlag = handlingFlagOf(handling, tags);
      if (handlingFlag) flags.push(handlingFlag);

      const comments = annotations.byPath.get(item.path)?.size ?? 0;
      if (comments > 0) {
        flags.push({
          key: "comments",
          glyph: "✱",
          label: String(comments),
          title: `${comments} comment${comments === 1 ? "" : "s"} recorded against this exact path.`,
        });
      }

      const prov = editInfo.get(item.path);
      // A malformed `ts` in the edit log must not become the literal string
      // "Invalid Date" in the flag, nor a NaN sort key: it is stated as unknown.
      const provMs = prov && Number.isFinite(prov.lastMs) ? prov.lastMs : 0;
      const edit =
        prov && prov.saves > 0
          ? {
              saves: prov.saves,
              actor: prov.actor,
              dateLabel: provMs > 0 ? DAY_FMT.format(new Date(provMs)) : "date unrecorded",
            }
          : undefined;
      if (edit) {
        flags.push({
          key: "edits",
          glyph: "✎",
          label: `${edit.saves} · ${edit.actor}`,
          title: `${edit.saves} saved edits in the edit log; recorded actor “${edit.actor}”.`,
        });
      }

      // ── companions and successors, from what the document itself names.
      const companions: { label: string; href: string }[] = [];
      const twin = siblings.twins.get(stripExt(item.path))?.find((p) => p !== item.path);
      if (twin) {
        companions.push({ label: `.${extOf(twin)}`, href: hrefFor(twin) });
      }
      for (const named of facts?.namedPaths ?? []) {
        const target = known.has(named) ? named : basenames.get(path.basename(named));
        if (!target || target === item.path) continue;
        if (companions.some((c) => c.href === hrefFor(target))) continue;
        companions.push({
          label: path.basename(target, path.extname(target)),
          href: hrefFor(target),
        });
      }
      for (const companion of companions.slice(0, 2)) {
        flags.push({
          key: `companion-${companion.href}`,
          glyph: "⇄",
          label: companion.label,
          title: `This artifact names ${companion.label} as a companion.`,
          href: companion.href,
        });
      }

      let supersededBy: OutputView["supersededBy"];
      const successorPath = facts?.archived?.successor;
      if (successorPath) {
        const resolved = known.has(successorPath) ? successorPath : undefined;
        supersededBy = resolved
          ? { label: path.basename(resolved, path.extname(resolved)), href: hrefFor(resolved) }
          : { label: successorPath };
        flags.push({
          key: "successor",
          glyph: "→",
          label: supersededBy.label,
          title: `The archive banner names ${successorPath} as its successor.`,
          ...(supersededBy.href ? { href: supersededBy.href } : {}),
        });
      }

      // ── dates: robin:updated is a claim, mtime is a fact. Two words, two facts.
      const updatedRaw = meta["robin:updated"]?.[0];
      const updatedMs = updatedRaw ? Date.parse(updatedRaw) : NaN;
      const hasUpdated = Number.isFinite(updatedMs);
      const mtimeLabel = DAY_FMT.format(item.mtime);
      const updatedLabel = hasUpdated ? DAY_FMT.format(new Date(updatedMs)) : undefined;
      const dateMs = hasUpdated ? updatedMs : item.mtime.getTime();
      const datesDisagree = hasUpdated && updatedLabel !== mtimeLabel;

      const view: OutputView = {
        path: item.path,
        href: item.href,
        title,
        recipient,
        scope,
        extent,
        extentShort,
        state,
        stateStatus: state === "DRAFT" ? "waiting" : "done",
        dateLabel: hasUpdated && updatedLabel ? updatedLabel : mtimeLabel,
        dateSource: hasUpdated ? "robin:updated" : "file touched",
        mtimeLabel,
        datesDisagree,
        flags,
        tags,
        companions,
        comments,
        opensAs,
        preview,
        sortKey: Math.max(item.mtime.getTime(), provMs),
        dateMs,
        stateRank: state === "DRAFT" ? 0 : state === "STABLE" ? 1 : state === "UNSTATED" ? 2 : 3,
        haystack: [title, recipient.text, summary ?? "", tags.join(" "), item.path]
          .join(" ")
          .toLowerCase(),
      };
      if (stateSource) view.stateSource = stateSource;
      if (updatedLabel) view.updatedLabel = updatedLabel;
      if (summary) view.summary = summary;
      if (supersededBy) view.supersededBy = supersededBy;
      if (edit) view.edit = edit;

      return { item, view, dir };
    }),
  );

  // ── series: one deliverable with several faces is ONE entry ────────────────
  const series = seriesOf(
    drafts.map((d) => ({
      path: d.view.path,
      dir: d.dir,
      mtime: d.item.mtime,
      ext: extOf(d.item.path),
      scope: d.view.scope,
      archived: d.view.scope === "archived",
    })),
  );
  const viewByPath = new Map(drafts.map((d) => [d.view.path, d.view]));
  for (const s of series) {
    for (const memberPath of s.members) {
      const view = viewByPath.get(memberPath);
      if (view) view.seriesId = s.id;
    }
  }

  // ── the .pptx beside its .html twin is a continuation row, not a series ────
  for (const d of drafts) {
    if (extOf(d.item.path) !== "pptx") continue;
    const twin = siblings.twins.get(stripExt(d.item.path))?.find((p) => p.endsWith(".html"));
    if (!twin) continue;
    d.view.childOf = twin;
    d.view.childLabel = "PowerPoint export of the above";
  }

  // ── inferred recipients, scoped to generator batches only ─────────────────
  // A batch of same-shaped documents each titled with a person's name is the one
  // place a subject can be read off an <h1>/<title> without smuggling an
  // assertion. Applying the same rule document-wide turned a LinkedIn storyboard
  // titled "Robin — …" into an artifact addressed to Robin, so it is confined
  // here and rendered muted + italic + "~" so it can never read as a quotation.
  for (const s of series) {
    if (!s.id.startsWith("batch:")) continue;
    for (const memberPath of s.members) {
      const view = drafts.find((d) => d.view.path === memberPath)?.view;
      if (!view || view.recipient.grade !== "none") continue;
      const subject = inferredSubject(view.title);
      if (!subject) continue;
      view.recipient = {
        text: subject,
        quote: view.title,
        source: "the subject named in this document’s own title",
        grade: "inferred",
      };
      // Scope was computed from an absent recipient; recompute it now, leaving
      // the two scopes that outrank the addressee (archived, handling-flagged).
      if (view.scope !== "archived" && view.scope !== "human") {
        view.scope = scopeOf(view.recipient, false, false);
      }
      view.haystack = `${view.haystack} ${subject.toLowerCase()}`;
    }
  }

  const items = drafts.map((d) => d.view);

  // ── groups ────────────────────────────────────────────────────────────────
  // A series lives in exactly one group — the first in scope order that holds a
  // member — so a batch whose members classify differently is never split.
  const seriesScope = new Map<string, Scope>();
  for (const s of series) {
    const scopes = s.members
      .map((p) => items.find((v) => v.path === p)?.scope)
      .filter((sc): sc is Scope => !!sc);
    const winner = SCOPE_ORDER.find((sc) => scopes.includes(sc)) ?? "unstated";
    s.scope = winner;
    seriesScope.set(s.id, winner);
  }

  const groups: GroupView[] = [];
  for (const scope of SCOPE_ORDER) {
    const scoped = items.filter((v) => {
      if (v.childOf) return false;
      if (v.seriesId) return seriesScope.get(v.seriesId) === scope;
      return v.scope === scope;
    });
    if (scoped.length === 0) continue;
    scoped.sort((a, b) => b.dateMs - a.dateMs);
    const entries: Entry[] = [];
    const seenSeries = new Set<string>();
    for (const v of scoped) {
      if (v.seriesId) {
        if (seenSeries.has(v.seriesId)) continue;
        seenSeries.add(v.seriesId);
        entries.push({ kind: "series", id: v.seriesId });
        continue;
      }
      entries.push({ kind: "row", path: v.path });
    }
    const latestMs = Math.max(...scoped.map((v) => v.dateMs));
    const group: GroupView = {
      scope,
      label: SCOPE_LABEL[scope],
      entries,
      latest: DAY_FMT.format(new Date(latestMs)),
    };
    if (groups.length === 0) group.note = "grouped by Robin from the addressee";
    groups.push(group);
  }

  // ── census: computed by the same extractor that filled the rows ───────────
  const census = censusOf(items);

  return { items, series, groups, census, orphanAnnotations: orphanCount(annotations, known) };
}

/** Events (not comments) whose page_path no longer resolves — five out/ paths
 *  drifted in the archive move. No fuzzy matching: the count is surfaced in the
 *  footer instead of being quietly folded into the per-row chips. */
function orphanCount(tally: AnnotationTally, known: Set<string>): number {
  let n = 0;
  for (const [pagePath, events] of tally.eventsByPath) {
    if (known.has(pagePath)) continue;
    n += events;
  }
  return n;
}

export function censusOf(items: OutputView[]): CensusEntry[] {
  const count = (fn: (v: OutputView) => boolean): number => items.filter(fn).length;
  const defs: { key: CensusKey; label: string; count: number }[] = [
    { key: "all", label: "all", count: items.length },
    { key: "addressed", label: "addressed", count: count((v) => v.recipient.grade !== "none") },
    {
      key: "unstated-recipient",
      label: "unstated-recipient",
      count: count((v) => v.recipient.grade === "none"),
    },
    { key: "stable", label: "stable", count: count((v) => v.state === "STABLE") },
    { key: "draft", label: "draft", count: count((v) => v.state === "DRAFT") },
    { key: "archived", label: "archived", count: count((v) => v.scope === "archived") },
    {
      key: "handling-flagged",
      label: "handling-flagged",
      count: count((v) => v.flags.some((f) => f.glyph === "◈")),
    },
    { key: "with-edit-history", label: "with edit history", count: count((v) => !!v.edit) },
  ];
  return defs.filter((d) => d.key === "all" || d.count > 0);
}

// ── sibling files (posters + format twins) ──────────────────────────────────

interface Siblings {
  /** `out/dir/name` (no extension) → the poster image beside it. */
  posters: Map<string, string>;
  /** `out/dir/name` (no extension) → every listed file sharing that stem. */
  twins: Map<string, string[]>;
}

function stripExt(relPath: string): string {
  return relPath.slice(0, relPath.length - path.extname(relPath).length);
}

/**
 * One readdir per out/ subdirectory. Needed because lib/catalog.ts filters every
 * image out of the listing, which also deletes the one real rendered poster in
 * the vault (presentations/example-design-slide-1.jpg). Reported
 * upstream; this is the local fallback the spec sanctions.
 */
async function listSiblings(vault: string, outputs: OutputItem[]): Promise<Siblings> {
  const twins = new Map<string, string[]>();
  for (const o of outputs) {
    const stem = stripExt(o.path);
    twins.set(stem, [...(twins.get(stem) ?? []), o.path]);
  }

  const dirs = Array.from(new Set(outputs.map((o) => path.dirname(o.path))));
  const posters = new Map<string, string>();
  await Promise.all(
    dirs.map(async (dir) => {
      const names = await fs.readdir(path.join(vault, dir)).catch(() => [] as string[]);
      for (const name of names) {
        const m = /^(.*?)(?:-slide-1|\.poster)\.(?:jpe?g|png)$/i.exec(name);
        if (!m?.[1]) continue;
        posters.set(`${dir}/${m[1]}`, `${dir}/${name}`);
      }
    }),
  );
  return { posters, twins };
}

function hrefFor(relPath: string): string {
  return relPath.endsWith(".html") ? vaultPageHref(relPath) : vaultFileHref(relPath);
}

/** fs.stat the relative <img src> list. Absolute/app-served srcs are skipped. */
async function countMissing(vault: string, dir: string, srcs: string[]): Promise<number> {
  if (srcs.length === 0) return 0;
  const results = await Promise.all(
    srcs.map(async (src): Promise<number> => {
      const clean = src.split("?")[0]?.split("#")[0] ?? src;
      try {
        await fs.stat(path.join(vault, dir, clean));
        return 0;
      } catch {
        return 1;
      }
    }),
  );
  return results.reduce((a, b) => a + b, 0);
}

// ── the single .md artifact ─────────────────────────────────────────────────

interface MdHead {
  title?: string;
  lines: number;
  head: string;
}

// Keyed on the path with an mtime check, exactly as factCache is: keying on
// `path:mtime` would leave one permanent entry per edit for the process
// lifetime.
const mdCache = new Map<string, { mtimeMs: number; head: MdHead }>();

async function readHead(vault: string, relPath: string, mtimeMs: number): Promise<MdHead> {
  const hit = mdCache.get(relPath);
  if (hit && hit.mtimeMs === mtimeMs) return hit.head;
  let raw = "";
  try {
    raw = await fs.readFile(path.join(vault, relPath), "utf-8");
  } catch {
    const empty: MdHead = { lines: 0, head: "" };
    mdCache.set(relPath, { mtimeMs, head: empty });
    return empty;
  }
  const lines = raw.split("\n");
  const heading = lines.find((l) => l.startsWith("# "));
  const head: MdHead = {
    lines: lines.length,
    head: lines.slice(0, MD_PEEK_LINES).join("\n"),
  };
  if (heading) head.title = heading.slice(2).trim();
  mdCache.set(relPath, { mtimeMs, head });
  return head;
}
