/**
 * View model for the /outputs ledger.
 *
 * Shared by the RSC (page.tsx), the deriver (derive.ts) and the client ledger
 * (OutputsBrowser.tsx). Types only — no runtime, so it is safe on both sides of
 * the server/client boundary.
 *
 * Design rule this model enforces: every optional field is optional because the
 * fact may genuinely not exist on disk. Nothing here has a "sensible default"
 * that would let the page state something the vault does not say.
 */

/** How Robin came to know the recipient. Rendered as three distinct grades. */
export type RecipientGrade = "quoted" | "inferred" | "none";

/** Scope groups. Robin's classification of a quoted string — disclosed in the UI. */
export type Scope = "outside" | "board" | "team" | "human" | "unstated" | "archived";

/** Sort modes; `recipient` (scope-grouped) is the default. */
export type SortMode = "recipient" | "date" | "activity" | "state";

/** Census toggle keys. Also the 1–9 keyboard targets, in this order. */
export type CensusKey =
  | "all"
  | "addressed"
  | "unstated-recipient"
  | "stable"
  | "draft"
  | "archived"
  | "handling-flagged"
  | "with-edit-history";

export interface CensusEntry {
  key: CensusKey;
  label: string;
  count: number;
}

export interface Recipient {
  /** What the FOR gutter prints (may be shortened). Empty when grade is 'none'. */
  text: string;
  /** The verbatim sentence the recipient was taken from. */
  quote?: string;
  /** The node the quote came from, e.g. `section.slide.cover .eyebrow`. */
  source?: string;
  grade: RecipientGrade;
}

/** A flag token. Rendered only when provably true; never a placeholder. */
export interface FlagView {
  key: string;
  /** Leading glyph: ⟂ render truth · ◈ handling · ✱ comments · ✎ edits · ⇄ companion · → successor. */
  glyph: string;
  label: string;
  /** Long form for `title` + the ≤1280px glyph-only mode. */
  title: string;
  tone?: "warn";
  href?: string;
}

export interface PeekPreview {
  kind: "iframe" | "video" | "poster" | "text" | "none";
  /** /api/file href for iframe + video. */
  src?: string;
  /** Poster image href when a rendered sibling exists on disk. */
  poster?: string;
  /** First lines of a .md artifact, labelled as raw source in the panel. */
  text?: string;
  /** Stated in words when there is nothing to show. */
  note?: string;
}

export interface OutputView {
  path: string;
  href: string;
  title: string;
  recipient: Recipient;
  scope: Scope;
  /** `Deck · 24 slides` — the honest measure of size. */
  extent: string;
  /** Unit-suffix-free form for the 1100–1280px band. */
  extentShort: string;
  /** STABLE | DRAFT | ARCHIVED | UNSTATED — never a defaulted "current". */
  state: string;
  /** Maps onto `.r-pill[data-status]`. */
  stateStatus: "done" | "waiting";
  /** Which meta key the state came from, stated in peek. */
  stateSource?: string;
  dateLabel: string;
  dateSource: string;
  /** Both dates, shown side by side in peek only when they disagree. */
  updatedLabel?: string;
  mtimeLabel: string;
  datesDisagree: boolean;
  flags: FlagView[];
  summary?: string;
  tags: string[];
  supersededBy?: { label: string; href?: string };
  companions: { label: string; href: string }[];
  /** Distinct annotation ids matching this exact path. */
  comments: number;
  edit?: { saves: number; actor: string; dateLabel: string };
  /** What the reader will actually do with this file. */
  opensAs: string;
  preview: PeekPreview;
  seriesId?: string;
  /** Rendered as an indented continuation row under its sibling. */
  childOf?: string;
  childLabel?: string;
  sortKey: number;
  dateMs: number;
  stateRank: number;
  /** Lower-cased title + recipient + summary + tags + path. */
  haystack: string;
}

export interface SeriesView {
  id: string;
  label: string;
  /** The one group this card lives in, so a mixed-scope batch is never split. */
  scope: Scope;
  /** The detection rule in its own words: `5 files · one generator run · 10 Jul 19:09`. */
  note: string;
  /** Stated on the card when the members cannot be told apart from disk. */
  caveat?: string;
  members: string[];
}

export type Entry = { kind: "row"; path: string } | { kind: "series"; id: string };

export interface GroupView {
  scope: Scope;
  label: string;
  /** Disclosure printed on the first group header only. */
  note?: string;
  latest?: string;
  entries: Entry[];
}

export interface LedgerData {
  items: OutputView[];
  series: SeriesView[];
  groups: GroupView[];
  census: CensusEntry[];
  /** Annotation events pointing at vault paths that no longer exist. */
  orphanAnnotations: number;
}
