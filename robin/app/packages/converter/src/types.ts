/**
 * Robin converter types.
 *
 * The disk format is HTML (see ROBIN_FORMAT.md). Internally we represent the
 * document body as `RobinBlock[]`, a small intermediate representation that:
 *   - is an in-memory step when converting markdown → canonical HTML (NOT persisted
 *     on disk in v0.2 — body HTML is the source of truth)
 *   - is editor-independent (a rich-text editor ↔ RobinBlock translation layer could
 *     be added later without changing the file format)
 *   - is round-trip stable (sorted keys, no transient ids, deterministic shape)
 */

export type RobinInline =
  | { kind: "text"; text: string; marks?: RobinMark[] }
  | { kind: "link"; href: string; content: RobinInline[] }
  // `marks` lets emphasis survive when it wraps a wikilink or inline code
  // (e.g. `**[[page]]**`, `` **`code`** ``) instead of being silently dropped.
  | { kind: "wikilink"; slug: string; alias?: string; marks?: RobinMark[] }
  | { kind: "code"; text: string; marks?: RobinMark[] }
  | { kind: "lineBreak" };

export type RobinMark = "bold" | "italic" | "strike";

export type RobinBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; content: RobinInline[] }
  | { kind: "paragraph"; content: RobinInline[] }
  | { kind: "bulletList"; items: RobinBlock[][] }
  | { kind: "numberedList"; items: RobinBlock[][]; start?: number }
  | { kind: "taskList"; items: RobinTaskItem[] }
  | { kind: "codeBlock"; lang?: string; code: string }
  | { kind: "quote"; children: RobinBlock[] }
  | {
      kind: "callout";
      calloutType: string;
      collapsed?: boolean;
      title?: string;
      children: RobinBlock[];
    }
  | { kind: "image"; src: string; alt?: string }
  | { kind: "embeddedImage"; slug: string; alt?: string }
  | { kind: "hubChildren"; query: string }
  | { kind: "thematicBreak" }
  | { kind: "table"; headers: RobinInline[][]; rows: RobinInline[][][] }
  | { kind: "html"; raw: string };

export interface RobinTaskItem {
  /**
   * Checkbox state: `true`/`false` for a real task item, or `null` for a plain
   * (non-checkbox) item that shares a list with task items. A mixed list
   * (`- [ ] task` + `- plain`) is rendered as a single taskList so the checkbox
   * state of the task items is preserved rather than dropped.
   */
  checked: boolean | null;
  content: RobinInline[];
  children?: RobinBlock[];
}

/** A normalized representation of frontmatter. */
export interface RobinFrontmatter {
  /** Verbatim original frontmatter, JSON-serializable. Lossless round-trip. */
  raw: Record<string, unknown>;
  /** Normalized meta-vocabulary fields (the subset promoted to <meta> tags). */
  meta: RobinMeta;
}

export interface RobinMeta {
  version: string;
  /** Immutable page identity introduced by the opt-in v0.3 migration. */
  id?: string;
  slug: string;
  path: string; // vault-relative
  type: string;
  updated: string; // ISO-8601 UTC
  created?: string;
  summary?: string;
  /**
   * Lifecycle status — the CANONICAL key. The on-disk vault convention stamps
   * `robin:status` (49 task pages). On input both `status` and `state` are
   * accepted (status wins); on output `metaTagsForHead` emits a single
   * `robin:status` tag.
   */
  status?: string;
  /**
   * Legacy synonym of `status`. Kept for lossless round-trip of older
   * `state:`-keyed sources, but it is folded into `status` and is no longer
   * emitted as a separate `robin:state` tag — pages converge to `robin:status`
   * on save.
   */
  state?: string;
  owner?: string;
  priority?: string;
  /** Task effort size: 1 = small, 2 = medium, 3 = large. */
  size?: number;
  /** Date the task is due (date-only convention: normalized to T00:00:00Z). */
  due?: string;
  /**
   * Planned START date of a task (date-only, normalized to T00:00:00Z). The
   * origin of the task's bar on the /standup timeline. Distinct from `due`
   * (the deadline) and `started` (when work actually began).
   */
  start?: string;
  /**
   * Planned END date of a task (date-only, normalized to T00:00:00Z). The
   * terminus of the task's bar on the /standup timeline. Readers fall back to
   * `due` when `end` is absent, so `end` is the schedule window, `due` the hard
   * deadline marker.
   */
  end?: string;
  /**
   * Free-form classification (e.g. project | infra | team | board | strategy).
   * Stamped on task pages as `robin:category`; first-class so it is no longer
   * silently dropped by a meta-only rewrite.
   */
  category?: string;
  project?: string;
  next_action?: string;
  acceptance?: string;
  /**
   * Task hierarchy role: `outcome` (grandparent / time-bounded theme),
   * `workstream` (parent epic), or `task` (actionable leaf). Absent on non-tasks
   * and on older leaves — consumers default missing kind to `task`.
   */
  kind?: string;
  /**
   * Immediate parent task slug (workstream under outcome, or leaf under
   * workstream). Grandparent is derived: parent(parent(task)). Single parent
   * only — dual-parent is expressed by body links, not multi-parent meta.
   */
  parent?: string;
  /**
   * Optional planned datetime for time-blocking a task on the day rail. Unlike
   * `due` (a date), this carries an hour — an absolute instant (ISO-8601 UTC).
   */
  planned?: string;
  role?: string;
  relationship?: string;
  started?: string;
  date?: string;
  duration?: string;
  tier?: string;
  tags: string[];
  attendees: string[];
  /**
   * Legacy v0.2 provenance values. For v0.3 pages this mirrors sourceRefs so
   * existing consumers remain readable while canonical output uses typed pairs.
   */
  sources: string[];
  /** Ordered v0.3 provenance kinds; index-aligned with sourceRefs. */
  sourceKinds?: RobinSourceKind[];
  /** Ordered v0.3 provenance refs; index-aligned with sourceKinds. */
  sourceRefs?: string[];
  /** Any frontmatter keys NOT in the vocabulary go here; they round-trip via raw only. */
  unknownKeys: string[];
}

export type RobinSourceKind =
  | "annotation"
  | "audio"
  | "conversation"
  | "document"
  | "email"
  | "import"
  | "manual"
  | "meeting"
  | "other"
  | "slack"
  | "upload"
  | "web";

export interface ConvertOptions {
  /** Vault-relative path for the output file, e.g. 'brain/risk-register.html'. */
  outputPath: string;
  /** Optional title override; defaults to first H1 or frontmatter title. */
  title?: string;
  /** Override `robin:updated`. Defaults to mtime if provided, else now. */
  updated?: Date;
  /** If true, the converter will fall back gracefully on unknown YAML. */
  lenient?: boolean;
}

export interface ConvertResult {
  html: string;
  meta: RobinMeta;
  blocks: RobinBlock[];
  warnings: string[];
}
