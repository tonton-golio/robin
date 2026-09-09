"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OutputPreview } from "./OutputPreview";
import type { CensusKey, LedgerData, OutputView, SeriesView, SortMode } from "./types";
import { useActiveDocumentRegistration } from "@/components/shell/ActiveDocumentProvider";

/**
 * The outputs ledger.
 *
 * One artifact = one row. The page's whole promise is stated in its header —
 * Robin can prove who wrote a thing and what was edited, it cannot prove it was
 * sent — and every element below obeys it: nothing is defaulted to a flattering
 * value, absence renders as absence, and inference is visually distinct from
 * quotation in the FOR gutter.
 */

const SORTS: SortMode[] = ["recipient", "date", "activity", "state"];

const SORT_LABEL: Record<SortMode, string> = {
  recipient: "recipient",
  date: "date",
  activity: "activity",
  state: "state",
};

/** Every census key, so `?only=` from the URL is validated, not cast. */
const CENSUS_KEYS: CensusKey[] = [
  "all",
  "addressed",
  "unstated-recipient",
  "stable",
  "draft",
  "archived",
  "handling-flagged",
  "with-edit-history",
];

/**
 * Mirrors CHORD_WINDOW_MS in LivingWorkspaceShell.
 *
 * The workspace shell owns `g <key>` navigation and registers its listener
 * first; `o`, `s`, and `h` are chord second-keys. This page keeps the same
 * short `g` window so its single-key bindings stand down for that next key.
 */
const CHORD_WINDOW_MS = 800;
const DOCK_KEY = "robin:outputs:dock";
const VIEW_KEY = "robin:outputs:view";

/** Card grid vs the dense one-line ledger. Cards are the default. */
type ViewMode = "cards" | "rows";

/** Tag chips a card prints before collapsing the rest into a +N affordance. */
const CARD_TAGS = 4;

/**
 * Extent kinds that get a card. "Deck · 8 slides" and "Doc · 1 page" are the
 * two common shapes a reader browses visually. Other formats with a rendered
 * poster also get cards; files without a visual remain compact rows.
 */
function isCardKind(item: OutputView): boolean {
  return !!item.preview.poster || /^(Deck|Doc|Diagram)\b/.test(item.extent);
}
/** Long enough that arrowing through the ledger loads nothing, short enough
 *  that stopping on a row feels like the preview was already there. */
const DOCK_SETTLE_MS = 220;
/** The dock renders the artifact at this width before scaling to the column. */
const DOCK_DESIGN_W = 860;
/** Decks lay out to a fixed slide width and crop if rendered narrower. */
const DECK_DESIGN_W = 1280;

/** Elements that own Enter/Space themselves and must keep them. */
const INTERACTIVE_SEL =
  'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [contenteditable="true"]';

/** Focusable descendants of the peek sheet, for the focus trap. */
const FOCUSABLE_SEL =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * True when the event target is a control that natively handles Enter/Space.
 *
 * Ledger rows are anchors too, but they delegate activation to this component
 * (an anchor does not activate on Space at all), so they are excluded.
 */
function ownsActivationKeys(t: HTMLElement | null): boolean {
  if (!t) return false;
  if (t.closest("[data-row]")) return false;
  return !!t.closest(INTERACTIVE_SEL);
}

/** Split a title on the search term so hits can carry `.r-hl`. */
function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="r-hl">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

/** One ledger row. Hoisted so React keeps the DOM node (and its focus) stable. */
function LedgerRow({
  item,
  child,
  isCursor,
  q,
  onCursor,
  onOpen,
  onPoint,
}: {
  item: OutputView;
  child?: boolean;
  isCursor: boolean;
  q: string;
  onCursor: (path: string) => void;
  onOpen: (path: string) => void;
  /** Hover/None — aims the preview dock without moving the keyboard cursor. */
  onPoint: (path: string | null) => void;
}): React.ReactElement {
  return (
    <a
      className={`out-row${child ? " out-row--child" : ""}`}
      href={item.href}
      data-row={item.path}
      aria-current={isCursor ? "true" : undefined}
      tabIndex={isCursor ? 0 : -1}
      onFocus={() => onCursor(item.path)}
      onMouseEnter={() => onPoint(item.path)}
      onMouseLeave={() => onPoint(null)}
      onClick={(e) => {
        // Cmd/Ctrl/Shift/middle-click stay native: opening rows in background
        // tabs is how a ledger is triaged, and routing them would clobber it.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(item.path);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen(item.path);
        }
      }}
    >
      <span
        className="out-for"
        data-grade={item.recipient.grade}
        title={item.recipient.quote ?? "This document names no addressee."}
      >
        {item.recipient.grade === "none"
          ? "—"
          : item.recipient.grade === "inferred"
            ? `~${item.recipient.text}`
            : item.recipient.text}
      </span>
      <span className="out-rowtitle">
        {child ? (
          <span className="out-rowtitle-lead" aria-hidden>
            └{" "}
          </span>
        ) : null}
        {highlight(child ? (item.childLabel ?? item.title) : item.title, q)}
      </span>
      <span className="out-extent r-mono">
        <span className="out-extent-long">{item.extent}</span>
        <span className="out-extent-short">{item.extentShort}</span>
      </span>
      <span className="out-statecell">
        {item.state === "UNSTATED" ? (
          // Not a pill. 18 of 32 artifacts declare no state, and that absence
          // must read as absence — a bordered UNSTATED badge would look like a
          // status the document asserts.
          <span
            className="out-unstated r-mono"
            title="This document declares neither robin:state nor robin:status."
          >
            unstated
          </span>
        ) : (
          <span className="r-pill" data-status={item.stateStatus} data-state={item.state}>
            {item.state}
          </span>
        )}
      </span>
      <span className="out-date r-mono" title={`${item.dateSource} ${item.dateLabel}`}>
        {item.dateLabel}
      </span>
      <span className="out-flags">
        {item.flags.map((f) => (
          <span key={f.key} className="out-flag r-mono" data-tone={f.tone} title={f.title}>
            <span className="out-flag-glyph" aria-hidden>
              {f.glyph}
            </span>
            <span className="out-flag-label">{f.label}</span>
          </span>
        ))}
      </span>
      {isCursor && item.summary ? <span className="out-sub">{item.summary}</span> : null}
    </a>
  );
}

/**
 * The card face. Only what is on disk gets drawn: a rendered poster sibling if
 * one exists, else a typographic plate naming the kind. Nothing here invents a
 * thumbnail — an artifact with no visual is stated as such.
 *
 * Deliberately NOT an iframe of the artifact. This page's whole preview design
 * turns on holding at most ONE live same-origin document (see OutputPreview:
 * the tile grid it replaced mounted ~27). A grid of live deck covers walks back
 * into that, and neither containment mechanism could be made to hold here —
 * `loading="lazy"` was measured on this page and did not defer a single one of
 * the 12, and IntersectionObserver never fired at all in this shell (verified
 * against a plainly-visible element, so the gate would have shown no covers).
 * The live cover still renders, one at a time, in the dock on hover.
 */
function CardFace({ item }: { item: OutputView }): React.ReactElement {
  if (item.preview.poster) {
    return (
      <span className="out-card-face" data-kind="poster">
        {/* eslint-disable-next-line @next/next/no-img-element -- vault file, not a Next-optimisable asset */}
        <img src={item.preview.poster} alt="" loading="lazy" decoding="async" />
      </span>
    );
  }
  return (
    <span className="out-card-face" data-kind="plate">
      <span className="out-card-plate r-mono" aria-hidden>
        {item.extentShort}
      </span>
    </span>
  );
}

function LedgerCard({
  item,
  isCursor,
  q,
  onCursor,
  onOpen,
  onPoint,
  onTag,
  activeTag,
}: {
  item: OutputView;
  isCursor: boolean;
  q: string;
  onCursor: (path: string) => void;
  onOpen: (path: string) => void;
  onPoint: (path: string | null) => void;
  /** Filter the ledger to one tag. */
  onTag: (tag: string) => void;
  /** The tag currently filtering, so the chip that caused it reads as pressed. */
  activeTag: string | null;
}): React.ReactElement {
  /*
   * The card is TWO siblings, not one anchor wrapping everything: the tag chips
   * are buttons, and a <button> inside an <a> is invalid HTML (and unreachable
   * by keyboard in practice). So the <li> carries the card surface, the anchor
   * covers the face and the text, and the tag row sits beside it. The anchor
   * keeps `data-row`, which is what the keyboard cursor and the dock resolve on.
   */
  return (
    <>
      <a
        className="out-card-hit"
        href={item.href}
        data-row={item.path}
        aria-current={isCursor ? "true" : undefined}
        tabIndex={isCursor ? 0 : -1}
        onFocus={() => onCursor(item.path)}
        onMouseEnter={() => onPoint(item.path)}
        onMouseLeave={() => onPoint(null)}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(item.path);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onOpen(item.path);
          }
        }}
      >
        <CardFace item={item} />
        <span className="out-card-body">
          <span
            className="out-card-for out-for"
            data-grade={item.recipient.grade}
            title={item.recipient.quote ?? "This document names no addressee."}
          >
            {item.recipient.grade === "none"
              ? "—"
              : item.recipient.grade === "inferred"
                ? `~${item.recipient.text}`
                : item.recipient.text}
          </span>
          <span className="out-card-title">{highlight(item.title, q)}</span>
          <span className="out-card-extent r-mono">{item.extent}</span>
        </span>
      </a>

      {/* Tags are a claim the file makes about itself, so an untagged file shows
          nothing here rather than a placeholder chip. */}
      {item.tags.length > 0 ? (
        <div className="out-card-tags">
          {item.tags.slice(0, CARD_TAGS).map((t) => (
            <button
              key={t}
              type="button"
              className="out-tag r-mono"
              aria-pressed={activeTag === t}
              title={`Filter to “${t}”`}
              onClick={() => onTag(t)}
            >
              {t}
            </button>
          ))}
          {item.tags.length > CARD_TAGS ? (
            <span
              className="out-tag out-tag--more r-mono"
              title={item.tags.slice(CARD_TAGS).join(" · ")}
            >
              +{item.tags.length - CARD_TAGS}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="out-card-foot">
        {item.state === "UNSTATED" ? (
          <span
            className="out-unstated r-mono"
            title="This document declares neither robin:state nor robin:status."
          >
            unstated
          </span>
        ) : (
          <span className="r-pill" data-status={item.stateStatus} data-state={item.state}>
            {item.state}
          </span>
        )}
        <span className="out-card-date r-mono" title={`${item.dateSource} ${item.dateLabel}`}>
          {item.dateLabel}
        </span>
        {item.flags.length > 0 ? (
          <span className="out-card-flags r-mono" aria-hidden>
            {item.flags.slice(0, 4).map((f) => (
              <span key={f.key} className="out-card-flag" data-tone={f.tone} title={f.title}>
                {f.glyph}
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </>
  );
}

interface RowBlock {
  kind: "row";
  item: OutputView;
  child?: OutputView;
}
interface SeriesBlock {
  kind: "series";
  series: SeriesView;
  items: OutputView[];
  hidden: number;
}
type Block = RowBlock | SeriesBlock;

interface RenderGroup {
  key: string;
  label: string;
  note?: string;
  latest?: string;
  count: number;
  blocks: Block[];
  collapsible?: boolean;
}

export function OutputsBrowser({ data }: { data: LedgerData }): React.ReactElement {
  const router = useRouter();
  const { items, series, groups, census, orphanAnnotations } = data;

  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<CensusKey>("all");
  const [sort, setSort] = useState<SortMode>("recipient");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [say, setSay] = useState("");
  /** The docked preview: on by default, and remembered. */
  const [dock, setDock] = useState(true);
  /** Card grid by default; the dense ledger is one keypress away and remembered. */
  const [view, setView] = useState<ViewMode>("cards");
  /**
   * The tag chip currently filtering, if any.
   *
   * Kept beside `query` rather than folded into it: tags already sit in the
   * per-item haystack, but typing "board" also matches titles and summaries,
   * and a chip that silently widened its own filter would be lying about what
   * it did. This matches the tag list exactly.
   */
  const [tag, setTag] = useState<string | null>(null);
  /** What the dock is aimed at — the pointed row wins over the cursor, so the
   *  mouse can survey the ledger without stealing the keyboard's place. */
  const [pointed, setPointed] = useState<string | null>(null);
  /** Settles behind cursor/hover changes so arrowing down 20 rows loads one
   *  document, not 20. */
  const [dockPath, setDockPath] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const provRef = useRef<HTMLDivElement | null>(null);
  const chordAtRef = useRef(0);
  const sayNonce = useRef(0);
  /** The `?open=` target, until it is either shown or honestly given up on. */
  const requestedOpen = useRef<string | null>(null);

  const byPath = useMemo(() => new Map(items.map((i) => [i.path, i])), [items]);
  const seriesById = useMemo(() => new Map(series.map((s) => [s.id, s])), [series]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  /**
   * Write the live region. aria-live only announces a *change*, so an identical
   * message (pressing `h` twice on the same history-less row) would be silence;
   * an alternating zero-width space makes every announcement a real change.
   */
  const announce = useCallback((message: string) => {
    sayNonce.current += 1;
    setSay(sayNonce.current % 2 === 0 ? `${message}\u200B` : message);
  }, []);

  // ── URL state: ?q= &sort= &only= &open=. Hydrated after mount so the server
  // render stays deterministic, then written back with replaceState.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only URL hydration; re-running it on an items/announce identity change would re-open a peek the user has since closed.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlQ = params.get("q");
    const urlSort = params.get("sort");
    const urlOnly = params.get("only");
    const urlOpen = params.get("open");
    const urlTag = params.get("tag");
    if (urlQ) setQuery(urlQ);
    // Only a tag some artifact actually declares — a stale ?tag= from an old
    // link must not silently empty the page with no way to see why.
    if (urlTag && items.some((i) => i.tags.includes(urlTag))) setTag(urlTag);
    if (urlSort && (SORTS as string[]).includes(urlSort)) setSort(urlSort as SortMode);
    if (urlOnly && (CENSUS_KEYS as string[]).includes(urlOnly)) setOnly(urlOnly as CensusKey);
    if (urlOpen) {
      const target = byPath.get(urlOpen);
      if (!target) {
        announce(`no artifact at ${urlOpen} — the link points at a path that is not in out/`);
      } else {
        // An archived target is behind a collapsed group; expanding it is the
        // honest way to honour the link rather than silently peeking at
        // whatever happens to sort first.
        if (target.scope === "archived") setArchiveOpen(true);
        requestedOpen.current = urlOpen;
        setPeek(urlOpen);
        setCursor(urlOpen);
      }
    }
  }, []);

  // ── docked preview ────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.localStorage.getItem(DOCK_KEY) === "off") setDock(false);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DOCK_KEY, dock ? "on" : "off");
  }, [dock]);

  // ── card grid vs dense ledger ─────────────────────────────────────────────
  useEffect(() => {
    if (window.localStorage.getItem(VIEW_KEY) === "rows") setView("rows");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  useEffect(() => {
    const target = pointed ?? cursor;
    if (target === dockPath) return;
    const t = window.setTimeout(() => setDockPath(target), DOCK_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [pointed, cursor, dockPath]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sort !== "recipient") params.set("sort", sort);
    if (only !== "all") params.set("only", only);
    if (tag) params.set("tag", tag);
    if (peek) params.set("open", peek);
    const search = params.toString();
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
  }, [q, sort, only, tag, peek]);

  // ── filtering ─────────────────────────────────────────────────────────────
  const passes = useCallback(
    (item: OutputView): boolean => {
      if (q && !item.haystack.includes(q)) return false;
      // Exact tag match, not a substring of the haystack — see the `tag` note.
      if (tag && !item.tags.includes(tag)) return false;
      switch (only) {
        case "all":
          return true;
        case "addressed":
          return item.recipient.grade !== "none";
        case "unstated-recipient":
          return item.recipient.grade === "none";
        case "stable":
          return item.state === "STABLE";
        case "draft":
          return item.state === "DRAFT";
        case "archived":
          return item.scope === "archived";
        case "handling-flagged":
          return item.flags.some((f) => f.glyph === "◈");
        case "with-edit-history":
          return !!item.edit;
        default:
          return true;
      }
    },
    [q, only, tag],
  );

  const matches = useMemo(() => items.filter(passes), [items, passes]);
  const matchSet = useMemo(() => new Set(matches.map((m) => m.path)), [matches]);
  const filtering = searching || only !== "all";

  // ── render model ──────────────────────────────────────────────────────────
  const renderGroups = useMemo<RenderGroup[]>(() => {
    const blockFor = (item: OutputView): Block | null => {
      if (item.seriesId) {
        const s = seriesById.get(item.seriesId);
        if (!s) return { kind: "row", item };
        const members = s.members.map((p) => byPath.get(p)).filter((v): v is OutputView => !!v);
        const shown = members.filter((m) => matchSet.has(m.path));
        if (shown.length === 0) return null;
        return { kind: "series", series: s, items: shown, hidden: members.length - shown.length };
      }
      const child = items.find((c) => c.childOf === item.path && matchSet.has(c.path));
      return child ? { kind: "row", item, child } : { kind: "row", item };
    };

    const flatten = (list: OutputView[]): Block[] => {
      const blocks: Block[] = [];
      const seenSeries = new Set<string>();
      for (const item of list) {
        if (item.childOf && byPath.has(item.childOf) && matchSet.has(item.childOf)) continue;
        if (item.seriesId) {
          if (seenSeries.has(item.seriesId)) continue;
          seenSeries.add(item.seriesId);
        }
        const block = blockFor(item);
        if (block) blocks.push(block);
      }
      return blocks;
    };

    // Grouped by scope only in the default recipient mode with nothing filtered.
    if (sort === "recipient" && !filtering) {
      const out: RenderGroup[] = [];
      for (const g of groups) {
        // A series belongs to exactly one group (derive.ts decides which), so a
        // batch whose members classify differently is never split across headers.
        const scoped = matches.filter((m) => {
          if (m.childOf) return false;
          if (m.seriesId) return seriesById.get(m.seriesId)?.scope === g.scope;
          return m.scope === g.scope;
        });
        if (scoped.length === 0) continue;
        scoped.sort((a, b) => b.dateMs - a.dateMs);
        const group: RenderGroup = {
          key: g.scope,
          label: g.label,
          count: scoped.length,
          blocks: flatten(scoped),
        };
        if (g.note) group.note = g.note;
        if (g.latest) group.latest = g.latest;
        if (g.scope === "archived") group.collapsible = true;
        out.push(group);
      }
      return out;
    }

    const sorted = [...matches].sort((a, b) => {
      if (sort === "activity") return b.sortKey - a.sortKey;
      if (sort === "state") return a.stateRank - b.stateRank || b.dateMs - a.dateMs;
      if (sort === "recipient") {
        return (
          (a.recipient.text || "￿").localeCompare(b.recipient.text || "￿") || b.dateMs - a.dateMs
        );
      }
      return b.dateMs - a.dateMs;
    });
    // Scope grouping only holds while the default recipient sort is intact and
    // nothing is filtered; otherwise the ledger is one honest flat list that
    // says how it is ordered.
    return [
      {
        key: "flat",
        label: searching ? `matches “${query.trim()}”` : "all artifacts",
        note: `ungrouped, sorted by ${SORT_LABEL[sort]}`,
        count: sorted.length,
        blocks: flatten(sorted),
      },
    ];
  }, [sort, filtering, groups, matches, matchSet, byPath, items, seriesById, searching, query]);

  // The three nearest path-substring matches, offered when nothing matched.
  // They are real ledger rows, so they join the cursor order below — a
  // suggestion you can only reach with a mouse is not a suggestion.
  const nearest = useMemo<OutputView[]>(() => {
    if (!searching || matches.length > 0) return [];
    for (let len = q.length - 1; len >= 3; len -= 1) {
      const stem = q.slice(0, len);
      const hits = items.filter((i) => i.path.toLowerCase().includes(stem)).slice(0, 3);
      if (hits.length > 0) return hits;
    }
    return [];
  }, [searching, matches.length, q, items]);

  // ── cursor order: every focusable row in render order, plus the group each
  //    index belongs to so crossing a boundary can be announced ──────────────
  const flow = useMemo<{ paths: string[]; starts: number[]; labels: string[] }>(() => {
    if (matches.length === 0) {
      return nearest.length > 0
        ? { paths: nearest.map((n) => n.path), starts: [0], labels: ["nearest by path"] }
        : { paths: [], starts: [], labels: [] };
    }
    const paths: string[] = [];
    const starts: number[] = [];
    const labels: string[] = [];
    for (const g of renderGroups) {
      if (g.collapsible && !archiveOpen) continue;
      starts.push(paths.length);
      labels.push(`${g.label} · ${g.count}`);
      for (const b of g.blocks) {
        if (b.kind === "row") {
          paths.push(b.item.path);
          if (b.child) paths.push(b.child.path);
        } else {
          for (const m of b.items) paths.push(m.path);
        }
      }
    }
    return { paths, starts, labels };
  }, [renderGroups, archiveOpen, matches.length, nearest]);

  const order = flow.paths;
  const groupStarts = flow.starts;

  const groupLabelAt = useCallback(
    (index: number): string => {
      let label = "";
      for (let i = 0; i < groupStarts.length; i += 1) {
        const start = groupStarts[i];
        if (start === undefined || start > index) break;
        label = flow.labels[i] ?? "";
      }
      return label;
    },
    [groupStarts, flow.labels],
  );

  // Keep the cursor on a row that still exists after a filter change.
  useEffect(() => {
    if (order.length === 0) {
      setCursor(null);
      return;
    }
    setCursor((cur) => (cur && order.includes(cur) ? cur : (order[0] ?? null)));
  }, [order]);

  // A `?open=` target that the current view excludes (collapsed archive, an
  // active filter, a query) is given up on out loud — it is never quietly
  // replaced by whatever sorts first.
  useEffect(() => {
    const want = requestedOpen.current;
    if (!want || order.length === 0) return;
    if (order.includes(want)) {
      requestedOpen.current = null;
      return;
    }
    requestedOpen.current = null;
    setPeek(null);
    announce(`${want} is not in the current view — a filter or search hides it`);
  }, [order, announce]);

  const focusRow = useCallback((path: string | null, takeFocus = true) => {
    if (!path) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(path)}"]`);
    if (!el) return;
    // While the peek sheet is open focus belongs inside it: the cursor still
    // moves (and swaps the sheet's src), but the row is only scrolled to.
    if (takeFocus) el.focus();
    el.scrollIntoView({ block: "nearest" });
  }, []);

  const move = useCallback(
    (delta: number) => {
      if (order.length === 0) return;
      const idx = cursor ? order.indexOf(cursor) : -1;
      const from = idx < 0 ? 0 : idx;
      const next = Math.max(0, Math.min(order.length - 1, from + delta));
      const target = order[next];
      if (!target) return;
      const crossed = groupLabelAt(next);
      if (idx >= 0 && crossed && crossed !== groupLabelAt(from)) announce(crossed);
      setCursor(target);
      focusRow(target, !peek);
    },
    [cursor, order, focusRow, groupLabelAt, announce, peek],
  );

  const jumpGroup = useCallback(
    (dir: 1 | -1) => {
      if (order.length === 0) return;
      const idx = cursor ? order.indexOf(cursor) : 0;
      const target =
        dir === 1
          ? (groupStarts.find((s) => s > idx) ?? order.length - 1)
          : ([...groupStarts].reverse().find((s) => s < idx) ?? 0);
      const path = order[target];
      if (!path) return;
      const crossed = groupLabelAt(target);
      if (crossed && crossed !== groupLabelAt(idx)) announce(crossed);
      setCursor(path);
      focusRow(path, !peek);
    },
    [cursor, order, groupStarts, focusRow, groupLabelAt, announce, peek],
  );

  const open = useCallback(
    (path: string | null) => {
      const item = path ? byPath.get(path) : null;
      if (item) router.push(item.href);
    },
    [byPath, router],
  );

  const cursorItem = cursor ? byPath.get(cursor) : undefined;
  const peekItem = peek ? byPath.get(peek) : undefined;

  useActiveDocumentRegistration({
    path: cursorItem?.path ?? "Publish · live",
    mode: "view",
    writeState: { kind: "read-only" },
    updatedAt: cursorItem ? new Date(cursorItem.dateMs).toISOString() : undefined,
  });

  // While peek is open the cursor drives it — the src swaps, a second iframe is
  // never mounted.
  useEffect(() => {
    if (peek && cursor && peek !== cursor) setPeek(cursor);
  }, [cursor, peek]);

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      // The workspace shell handled it (`g` chord, `?`, ⌘K): never act twice.
      if (e.defaultPrevented) return;

      const t = e.target as HTMLElement | null;
      const inField =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Mirror the workspace shell's `g` window and stand down for its second key.
      if (!inField && e.key === "g") {
        chordAtRef.current = Date.now();
        return;
      }
      const chordArmed =
        chordAtRef.current > 0 && Date.now() - chordAtRef.current <= CHORD_WINDOW_MS;
      chordAtRef.current = 0;
      if (chordArmed) return;

      if (e.key === "/" && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (inField) {
        if (e.key === "Escape") (t as HTMLElement).blur();
        return;
      }

      // Buttons, links and selects keep the keys they own. Without this the
      // census toggles, sort buttons, archive disclosure and the peek sheet's
      // own actions are all un-activatable from the keyboard.
      const activationOwner = ownsActivationKeys(t);

      if (/^[1-9]$/.test(e.key)) {
        const entry = census[Number(e.key) - 1];
        if (entry) {
          e.preventDefault();
          setOnly((cur) => (cur === entry.key ? "all" : entry.key));
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (e.shiftKey) jumpGroup(1);
          else move(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          if (e.shiftKey) jumpGroup(-1);
          else move(-1);
          break;
        case "j":
          e.preventDefault();
          move(1);
          break;
        case "k":
          e.preventDefault();
          move(-1);
          break;
        case "J":
          e.preventDefault();
          jumpGroup(1);
          break;
        case "K":
          e.preventDefault();
          jumpGroup(-1);
          break;
        case "Home":
          e.preventDefault();
          move(-order.length);
          break;
        case "End":
        case "G":
          e.preventDefault();
          move(order.length);
          break;
        case " ":
          if (activationOwner) return;
          e.preventDefault();
          setPeek((cur) => (cur ? null : cursor));
          break;
        case "Enter":
          // A real handler, not incidental link behaviour. When the cursor row
          // itself has focus its own onKeyDown already fired, so stand down —
          // as does any control that activates on Enter by itself.
          if (activationOwner || t?.hasAttribute("data-row")) return;
          e.preventDefault();
          open(cursor);
          break;
        case "o":
          e.preventDefault();
          open(cursor);
          break;
        case "s":
          e.preventDefault();
          setSort((cur) => SORTS[(SORTS.indexOf(cur) + 1) % SORTS.length] ?? "recipient");
          break;
        case "v":
          e.preventDefault();
          setDock((cur) => {
            announce(cur ? "preview hidden" : "preview shown");
            return !cur;
          });
          break;
        case "c":
          if (activationOwner) break;
          e.preventDefault();
          setView((cur) => {
            const next = cur === "cards" ? "rows" : "cards";
            announce(next === "cards" ? "card grid" : "dense ledger");
            return next;
          });
          break;
        case "h": {
          e.preventDefault();
          if (!cursorItem) return;
          if (!cursorItem.edit) {
            announce(`no edit history recorded for ${cursorItem.title}`);
            return;
          }
          setPeek(cursor);
          window.requestAnimationFrame(() => provRef.current?.scrollIntoView({ block: "nearest" }));
          break;
        }
        case "Escape":
          if (peek) {
            e.preventDefault();
            setPeek(null);
          } else if (query) {
            e.preventDefault();
            setQuery("");
          } else if (tag) {
            e.preventDefault();
            setTag(null);
          } else if (only !== "all") {
            e.preventDefault();
            setOnly("all");
          }
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    census,
    cursor,
    cursorItem,
    jumpGroup,
    move,
    only,
    open,
    order.length,
    peek,
    query,
    tag,
    announce,
  ]);

  const row = useCallback(
    (item: OutputView, child?: boolean): React.ReactElement => (
      <LedgerRow
        key={item.path}
        item={item}
        {...(child ? { child: true } : {})}
        isCursor={cursor === item.path}
        q={q}
        onCursor={setCursor}
        onOpen={open}
        onPoint={setPointed}
      />
    ),
    [cursor, q, open],
  );

  const onTag = useCallback(
    (t: string) => {
      setTag((cur) => (cur === t ? null : t));
    },
    [],
  );

  const card = useCallback(
    (item: OutputView): React.ReactElement => (
      <LedgerCard
        key={item.path}
        item={item}
        isCursor={cursor === item.path}
        q={q}
        onCursor={setCursor}
        onOpen={open}
        onPoint={setPointed}
        onTag={onTag}
        activeTag={tag}
      />
    ),
    [cursor, q, open, onTag, tag],
  );

  /**
   * One block, drawn the way the current view asks for. In card view a block
   * whose artifact has no visual face still gets a row. A format companion
   * remains available beneath its parent's preview card.
   */
  const drawBlock = useCallback(
    (b: RowBlock): React.ReactElement => {
      const asCard = view === "cards" && isCardKind(b.item);
      return (
        <li key={b.item.path} className={asCard ? "out-cardcell" : "out-rowcell"}>
          {asCard ? (
            <>
              {card(b.item)}
              {b.child ? (
                <a
                  className="r-btn r-btn--ghost"
                  href={b.child.href}
                  data-row={b.child.path}
                  onFocus={() => setCursor(b.child!.path)}
                  onMouseEnter={() => setPointed(b.child!.path)}
                >
                  {b.child.childLabel ?? b.child.title}
                </a>
              ) : null}
            </>
          ) : (
            <>
              {row(b.item)}
              {b.child ? row(b.child, true) : null}
            </>
          )}
        </li>
      );
    },
    [view, card, row],
  );

  return (
    <div
      className={`out-page${peekItem ? " is-peeking" : ""}${dock ? " has-dock" : ""}`}
      ref={rootRef}
      onMouseLeave={() => setPointed(null)}
    >
      {/* The measured track for the responsive bands. Keyed to the content
          container, not the viewport: the shell rail eats 224px, so a 1360px
          window is a ~1080px ledger and viewport breakpoints fire late. */}
      <div className="out-main">
        <header className="out-head">
          <span className="r-bar">Out</span>
          <h1 className="r-stepped">{items.length} artifacts made for other people</h1>
          <p className="out-ceiling r-mono">
            Robin can prove who wrote it and what was edited. It cannot prove it was sent.
          </p>
        </header>

        <div className="out-searchrow">
          <label className="out-searchbox">
            <span className="out-mag" aria-hidden>
              ⌕
            </span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search title · recipient · summary · tag · path"
              aria-label="Search outputs by title, recipient, summary, tag or path"
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                className="out-searchclear"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <X size={13} strokeWidth={2} />
              </button>
            ) : (
              <span className="out-slash" aria-hidden>
                /
              </span>
            )}
          </label>
        </div>

        <div className="out-census" role="group" aria-label="Filter by coverage">
          {census.map((c, i) => (
            <React.Fragment key={c.key}>
              {i > 0 ? (
                <span className="out-csep r-mono" aria-hidden>
                  ·
                </span>
              ) : null}
              <button
                type="button"
                className="out-cbtn r-mono"
                aria-pressed={only === c.key}
                title={`${c.count} · key ${i + 1}`}
                onClick={() => setOnly((cur) => (cur === c.key ? "all" : c.key))}
              >
                <span className="out-cn">{c.count}</span> {c.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="out-sortline">
          <span className="out-sorts r-mono">
            <span className="out-sortlab">sort</span>
            {SORTS.map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 ? (
                  <span className="out-sortsep" aria-hidden>
                    ▸
                  </span>
                ) : null}
                <button
                  type="button"
                  className="out-sortbtn"
                  aria-pressed={sort === s}
                  onClick={() => setSort(s)}
                >
                  {SORT_LABEL[s]}
                </button>
              </React.Fragment>
            ))}
          </span>
          <span className="out-sortright">
            <span className="out-keys r-mono">
              ↑↓/jk move · space peek · ↵/o open · s sort · c cards · h history · 1–9 filter · / search
            </span>
            <button
              type="button"
              className="out-dockbtn r-mono"
              aria-pressed={view === "cards"}
              onClick={() => setView((cur) => (cur === "cards" ? "rows" : "cards"))}
              title="Cards show a face and the file's own tags; rows are the dense ledger (c)"
            >
              cards <span aria-hidden>c</span>
            </button>
            <button
              type="button"
              className="out-dockbtn r-mono"
              aria-pressed={dock}
              onClick={() => setDock((cur) => !cur)}
              title="Preview the pointed artifact beside the ledger (v)"
            >
              preview <span aria-hidden>v</span>
            </button>
          </span>
        </div>

        {tag ? (
          <p className="out-tagbar r-mono">
            <span className="out-tagbar-lab">filtered by tag</span>
            <span className="out-tag out-tag--active">{tag}</span>
            <button type="button" className="out-tagbar-x" onClick={() => setTag(null)}>
              clear (esc)
            </button>
            <span className="out-tagbar-n">
              {matches.length} of {items.length}
            </span>
          </p>
        ) : null}

        <p className="out-legend r-mono">
          FOR column: PLAIN = quoted from the document · <i>~italic</i> = inferred by Robin · — =
          none stated
        </p>

        <p className="out-sr" role="status" aria-live="polite">
          {say}
        </p>

        {items.length === 0 ? (
          <div className="r-card r-card--flat out-empty">
            <p className="out-empty-t">Nothing in out/ yet.</p>
            <p>out/ holds artifacts made with Robin for other people — decks, plans, reports.</p>
            <p className="r-mono">base/out/</p>
          </div>
        ) : matches.length === 0 ? (
          <div className="out-none">
            <p className="out-none-line r-mono">
              {searching
                ? `no artifact matches «${query.trim()}» in title, recipient, summary, tags or path — bodies are not indexed`
                : `nothing in out/ is ${census.find((c) => c.key === only)?.label ?? only}`}
            </p>
            {nearest.length > 0 ? (
              <>
                <p className="out-none-line r-mono">nearest by path:</p>
                <ul className="out-led">
                  {nearest.map((item) => (
                    <li key={item.path}>{row(item)}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <button
              type="button"
              className="r-btn r-btn--ghost"
              onClick={() => {
                setQuery("");
                setOnly("all");
                setTag(null);
              }}
            >
              clear (esc)
            </button>
          </div>
        ) : (
          <div className="out-groups">
            {renderGroups.map((g) => (
              <section key={g.key} className="out-group">
                {g.collapsible ? (
                  <button
                    type="button"
                    className="out-ghead out-ghead--toggle"
                    aria-expanded={archiveOpen}
                    onClick={() => setArchiveOpen((v) => !v)}
                  >
                    <span className="out-glabel">{g.label}</span>
                    <span className="out-gnote r-mono">
                      {g.count} · superseded or delivered · {archiveOpen ? "hide" : "show"}
                    </span>
                  </button>
                ) : (
                  <div className="out-ghead">
                    <span className="out-glabel">{g.label}</span>
                    <span className="out-gnote r-mono">
                      {g.count}
                      {g.note ? ` · ${g.note}` : ""}
                      {g.latest ? ` · latest ${g.latest}` : ""}
                    </span>
                  </div>
                )}
                {g.collapsible && !archiveOpen ? null : (
                  <ul className={view === "cards" ? "out-cards" : "out-led"}>
                    {g.blocks.map((b) =>
                      b.kind === "row" ? (
                        drawBlock(b)
                      ) : (
                        // The card carries its own edges; the ledger hairline
                        // would otherwise float unattached 8px below it.
                        <li key={b.series.id} className="out-led-series out-cards-span">
                          <div className="out-series">
                            <div className="out-series-head">
                              <span className="out-glabel">{b.series.label}</span>
                              <span className="out-gnote r-mono">
                                {b.series.note}
                                {b.hidden > 0
                                  ? ` · ${b.items.length} of ${b.series.members.length} matching`
                                  : ""}
                              </span>
                            </div>
                            <ul
                              className={
                                view === "cards"
                                  ? "out-cards out-series-cards"
                                  : "out-led out-series-list"
                              }
                            >
                              {b.items.map((m) =>
                                view === "cards" && isCardKind(m) ? (
                                  <li key={m.path} className="out-cardcell">
                                    {card(m)}
                                  </li>
                                ) : (
                                  <li key={m.path} className="out-rowcell">
                                    {row(m)}
                                  </li>
                                ),
                              )}
                            </ul>
                            {b.series.caveat ? (
                              <p className="out-series-caveat r-mono">{b.series.caveat}</p>
                            ) : null}
                          </div>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}

        {orphanAnnotations > 0 ? (
          <p className="out-foot r-mono">
            {orphanAnnotations} annotation events point at vault paths that no longer exist.{" "}
            <a href="/maintenance">→ /maintenance</a>
          </p>
        ) : null}
      </div>

      {dock ? (
        <PreviewDock
          item={dockPath ? (byPath.get(dockPath) ?? null) : null}
          /* Exactly one live document on the page: while the peek sheet is up it
             owns the preview, and the dock stands down to a stated placeholder. */
          suspended={!!peekItem}
          onOpen={open}
          onPeek={(path) => {
            setCursor(path);
            setPeek(path);
          }}
          onHide={() => setDock(false)}
        />
      ) : null}

      {peekItem ? (
        <PeekPanel
          item={peekItem}
          provRef={provRef}
          onClose={() => {
            setPeek(null);
            focusRow(cursor);
          }}
          onOpen={() => open(peekItem.path)}
        />
      ) : null}
    </div>
  );
}

/**
 * The docked preview. It follows whatever the ledger is pointed at — hovered
 * row, else the keyboard cursor — so the page shows the artifact continuously
 * instead of only on demand, while still mounting at most ONE live document.
 * It is a complement to the ledger, never a gate: every fact in it is also in
 * the row, and it is dismissible (`v`).
 */
function PreviewDock({
  item,
  suspended,
  onOpen,
  onPeek,
  onHide,
}: {
  item: OutputView | null;
  suspended: boolean;
  onOpen: (path: string) => void;
  onPeek: (path: string) => void;
  onHide: () => void;
}): React.ReactElement {
  const isDeck = !!item && item.extent.toLowerCase().startsWith("deck");
  return (
    <aside className="out-dock" aria-label="Preview of the pointed artifact">
      <div className="out-dock-inner">
        <div className="out-dock-bar">
          <span className="out-dock-lab r-mono">preview</span>
          <button
            type="button"
            className="out-dock-hide r-mono"
            onClick={onHide}
            title="Hide the preview (v)"
          >
            hide <span aria-hidden>v</span>
          </button>
        </div>

        {!item ? (
          <p className="out-dock-note r-mono">
            point at a row — hover, or move the cursor with ↑↓ — to preview it here.
          </p>
        ) : suspended ? (
          <p className="out-dock-note r-mono">shown in the peek sheet.</p>
        ) : (
          <>
            <div className="out-dock-frame" data-shape={isDeck ? "slide" : "page"}>
              <OutputPreview
                key={item.path}
                preview={item.preview}
                title={item.title}
                /* A deck lays out to a fixed slide width; rendering it into a
                   narrow viewport crops it. Reports reflow, so they get the
                   narrow render and the bigger scale. */
                designWidth={isDeck ? DECK_DESIGN_W : DOCK_DESIGN_W}
                aspect={isDeck ? 0.58 : 0.78}
              />
            </div>
            <p className="out-dock-for r-mono" data-grade={item.recipient.grade}>
              {item.recipient.grade === "none"
                ? "no recipient stated"
                : item.recipient.grade === "inferred"
                  ? `for ~${item.recipient.text}`
                  : `for ${item.recipient.text}`}
            </p>
            <h2 className="out-dock-title">{item.title}</h2>
            <p className="out-dock-meta r-mono">
              {item.extent} · {item.state === "UNSTATED" ? "unstated" : item.state.toLowerCase()} ·{" "}
              {item.dateLabel}
            </p>
            {item.summary ? <p className="out-dock-sum">{item.summary}</p> : null}
            {item.flags.length > 0 ? (
              <p className="out-dock-flags r-mono">
                {item.flags.map((f) => (
                  <span key={f.key} data-tone={f.tone} title={f.title}>
                    {f.glyph} {f.label}
                  </span>
                ))}
              </p>
            ) : null}
            <div className="out-dock-acts">
              <button type="button" className="r-btn" onClick={() => onOpen(item.path)}>
                Open ↵
              </button>
              <button
                type="button"
                className="r-btn r-btn--ghost"
                onClick={() => onPeek(item.path)}
              >
                Facts ␣
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="out-peek-kv">
      <dt className="out-peek-k">{label}</dt>
      <dd className="out-peek-v">{children}</dd>
    </div>
  );
}

function PeekPanel({
  item,
  provRef,
  onClose,
  onOpen,
}: {
  item: OutputView;
  provRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onOpen: () => void;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);

  // The sheet is a modal surface: focus moves in on open, Tab cycles inside it
  // rather than wandering onto rows the sheet covers, and the caller restores
  // focus to the originating row on close.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE_SEL);
    (first ?? panel).focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SEL));
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      {/* The scrim dims the ledger to the specced --card-2 step so the sheet has
          ground under it; clicking it is the mouse equivalent of esc. */}
      <div className="out-peek-scrim" aria-hidden onClick={onClose} />
      <aside
        className="out-peek"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${item.title}`}
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="out-peek-head">
          <div className="out-peek-title">
            <span className="out-for" data-grade={item.recipient.grade}>
              {item.recipient.grade === "none"
                ? "—"
                : item.recipient.grade === "inferred"
                  ? `~${item.recipient.text}`
                  : item.recipient.text}
            </span>
            <h2>{item.title}</h2>
            <p className="r-mono out-peek-path">{item.path}</p>
          </div>
          <button type="button" className="r-btn r-btn--ghost out-peek-x" onClick={onClose}>
            esc
          </button>
        </div>

        <OutputPreview preview={item.preview} title={item.title} />

        <dl className="out-peek-facts">
          <Fact label="Recipient">
            {item.recipient.quote ? (
              <>
                <span className="out-peek-src-note r-mono">
                  quoted from {item.recipient.source}:
                </span>
                <br />“{item.recipient.quote}”
                {item.recipient.grade === "inferred" ? (
                  <>
                    <br />
                    <span className="out-peek-src-note r-mono">
                      inferred by Robin, not an addressee line
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              "no addressee line in this document"
            )}
          </Fact>
          <Fact label="Summary">{item.summary ?? "no robin:summary on this file"}</Fact>
          <Fact label="State">
            {item.stateSource
              ? `${item.stateSource} = ${item.state.toLowerCase()}`
              : "no state declared — UNSTATED"}
          </Fact>
          <Fact label="Dates">
            {item.datesDisagree ? (
              <>
                robin:updated {item.updatedLabel}
                <br />
                file touched {item.mtimeLabel}
              </>
            ) : (
              `${item.dateSource} ${item.dateLabel}`
            )}
          </Fact>
          <Fact label="Comments">
            {item.comments > 0
              ? `${item.comments} · exact path match`
              : "no comments recorded against this path"}
          </Fact>
          <div className="out-peek-kv" ref={provRef}>
            <dt className="out-peek-k">Edits</dt>
            <dd className="out-peek-v">
              {item.edit ? (
                <span className="r-prov">
                  <b>{item.edit.saves}</b> saved edits · last {item.edit.dateLabel} · recorded actor{" "}
                  <span className="r-actor">{item.edit.actor}</span>
                </span>
              ) : (
                "no edit-log entries for this file"
              )}
            </dd>
          </div>
          <Fact label="Opens as">{item.opensAs}</Fact>
          {item.supersededBy ? (
            <Fact label="Superseded by">
              {item.supersededBy.href ? (
                <a href={item.supersededBy.href}>{item.supersededBy.label}</a>
              ) : (
                item.supersededBy.label
              )}
            </Fact>
          ) : null}
          {item.tags.length > 0 ? <Fact label="Tags">{item.tags.join(" · ")}</Fact> : null}
        </dl>

        <div className="out-peek-actions">
          <button type="button" className="r-btn r-btn--primary" onClick={onOpen}>
            Open ↵
          </button>
          <button
            type="button"
            className="r-btn"
            onClick={() => {
              void navigator.clipboard?.writeText(item.path).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Copied" : "Copy path"}
          </button>
        </div>
      </aside>
    </>
  );
}
