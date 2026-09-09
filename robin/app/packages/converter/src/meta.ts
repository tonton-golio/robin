import type { RobinFrontmatter, RobinMeta, RobinSourceKind } from "./types.js";

const SPEC_VERSION = "0.2";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const KNOWN_KEYS = new Set([
  "type",
  "version",
  "id",
  "summary",
  "state",
  "status",
  "owner",
  "priority",
  "size",
  "due",
  "start",
  "end",
  "project",
  "next_action",
  "acceptance",
  "category",
  "kind",
  "parent",
  "planned",
  "role",
  "relationship",
  "started",
  "updated",
  "created",
  "date",
  "duration",
  "tier",
  "tags",
  "attendees",
  "source",
  "sources",
  "source_kind",
  "source_kinds",
  "source_ref",
  "source_refs",
  "title",
  "name",
  "aliases",
]);

/**
 * The fully-qualified `robin:*` <meta> names the canonical writer
 * ({@link metaTagsForHead}) is able to emit from a {@link RobinMeta}. Any
 * `robin:*` tag on a page NOT in this set is "extra" — it has no RobinMeta field
 * and would be dropped by a meta-only rebuild unless spliced back in. Shared by
 * the web write path and the MCP server so both treat the same names as
 * canonical (no drift). `robin:state` is included because it is folded into
 * `robin:status` on write and must NOT be re-emitted as a duplicate extra tag.
 */
export const CANONICAL_META_NAMES = new Set([
  "robin:version",
  "robin:id",
  "robin:slug",
  "robin:path",
  "robin:type",
  "robin:updated",
  "robin:created",
  "robin:summary",
  "robin:status",
  "robin:state",
  "robin:owner",
  "robin:priority",
  "robin:size",
  "robin:due",
  "robin:start",
  "robin:end",
  "robin:project",
  "robin:next_action",
  "robin:acceptance",
  "robin:category",
  "robin:kind",
  "robin:parent",
  "robin:planned",
  "robin:role",
  "robin:relationship",
  "robin:started",
  "robin:date",
  "robin:duration",
  "robin:tier",
  "robin:tag",
  "robin:attendee",
  "robin:source",
  "robin:source-kind",
  "robin:source-ref",
]);

export const ROBIN_SOURCE_KINDS = new Set<RobinSourceKind>([
  "annotation",
  "audio",
  "conversation",
  "document",
  "email",
  "import",
  "manual",
  "meeting",
  "other",
  "slack",
  "upload",
  "web",
]);

/**
 * `robin:*` tags that are deliberately RETIRED — actively dropped on every
 * rewrite rather than preserved as custom metadata. `robin:workflow` (the task
 * lane field removed 2026-06-03) lives here so any stray tag left on an old
 * page, template, or git stash is cleaned the next time the page is saved,
 * instead of being round-tripped forever by the extra-meta splice. Without this
 * the splice would faithfully preserve it (it is no longer canonical), so this
 * is what actually enforces the removal at the format layer.
 */
export const DROPPED_META_NAMES = new Set(["robin:workflow"]);

/**
 * Collect the `robin:*` <meta> tags that the canonical writer cannot express via
 * RobinMeta (robin:review-by, and any other custom tag), so a frontmatter-only
 * rewrite can splice them back into <head> instead of silently dropping them.
 * Input is a metaMap keyed by fully-qualified `robin:*` name with array values.
 * Returns sorted [name, content] pairs (one per value of a repeated tag).
 * Tags in {@link DROPPED_META_NAMES} are intentionally excluded (retired).
 */
export function collectExtraMetaTags(metaMap: Record<string, string[]>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [name, values] of Object.entries(metaMap)) {
    if (!name.startsWith("robin:")) continue;
    if (CANONICAL_META_NAMES.has(name)) continue;
    if (DROPPED_META_NAMES.has(name)) continue;
    for (const v of values) out.push([name, v]);
  }
  out.sort((a, b) =>
    a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
  return out;
}

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a date-ish value to ISO-8601 UTC.
 * Accepts: Date, string ISO date, string ISO datetime, naked YYYY-MM-DD.
 * Returns: e.g. "2026-05-26T00:00:00Z"
 */
export function normalizeDate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString().replace(/\.\d{3}Z$/, "Z");
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (ISO_DATE_RE.test(trimmed)) return `${trimmed}T00:00:00Z`;
  if (ISO_DATETIME_RE.test(trimmed)) {
    // A zone-less datetime (e.g. "2026-05-26T10:30:00") is parsed as LOCAL time
    // by `new Date`, so .toISOString() would shift it by the host's offset and
    // produce different on-disk timestamps per machine. Anchor it to UTC so the
    // conversion is deterministic across timezones.
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
    const d = new Date(hasZone ? trimmed : `${trimmed}Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  // Unknown date format — return as-is rather than fail; round-tripped via raw.
  return trimmed;
}

/** Coerce a task size into the integer 1|2|3, or undefined if absent/invalid. */
export function normalizeSize(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return undefined;
  const rounded = Math.round(n);
  return rounded >= 1 && rounded <= 3 ? rounded : undefined;
}

const TASK_KINDS = new Set(["outcome", "workstream", "task"]);

/** Coerce task hierarchy kind to outcome|workstream|task, else undefined. */
export function normalizeTaskKind(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const k = String(value).trim().toLowerCase();
  return TASK_KINDS.has(k) ? k : undefined;
}

/** Coerce a YAML scalar/array/comma-string into a string[]. */
export function toStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value))
    return value
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean);
  if (typeof value === "string") {
    // Obsidian-comma form: "risk, register"
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [String(value)];
}

/** Slugify a string: lowercase ASCII kebab-case. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 100);
}

export interface NormalizeArgs {
  frontmatter: Record<string, unknown>;
  slug: string;
  outputPath: string;
  title: string;
  updated?: Date;
}

export function normalizeFrontmatter(args: NormalizeArgs): RobinFrontmatter {
  const { frontmatter, slug, outputPath, title, updated } = args;
  const rawVersion = frontmatter.version;
  if (
    rawVersion !== undefined &&
    rawVersion !== null &&
    (typeof rawVersion !== "string" || !["0.1", "0.2", "0.3"].includes(rawVersion.trim()))
  ) {
    throw new Error(`Unsupported Robin producer version: ${String(rawVersion)}`);
  }
  const requestedVersion =
    typeof rawVersion === "string" && rawVersion.trim() ? rawVersion.trim() : SPEC_VERSION;
  // v0.3 is staged and must be requested explicitly. Missing and known legacy
  // producer inputs converge to the current default; unknown future versions
  // fail closed so a normal write cannot silently downgrade them.
  const version = requestedVersion === "0.3" ? "0.3" : SPEC_VERSION;
  const requestedId = (frontmatter.id as string | undefined)?.trim().toLowerCase() || undefined;
  const id = version === "0.3" ? requestedId : undefined;
  if (version === "0.3" && (!id || !UUID_RE.test(id))) {
    throw new Error("Robin v0.3 pages require a valid immutable UUID in frontmatter.id");
  }
  const sourceKinds = [
    ...toStringArray(frontmatter.source_kind),
    ...toStringArray(frontmatter.source_kinds),
  ] as RobinSourceKind[];
  const sourceRefs = [
    ...toStringArray(frontmatter.source_ref),
    ...toStringArray(frontmatter.source_refs),
  ];
  if (version !== "0.3" && (requestedId || sourceKinds.length > 0 || sourceRefs.length > 0)) {
    throw new Error("Robin id and typed provenance require frontmatter.version 0.3");
  }
  if (sourceKinds.some((kind) => !ROBIN_SOURCE_KINDS.has(kind))) {
    throw new Error(`Invalid robin:source-kind: ${sourceKinds.join(", ")}`);
  }
  if (sourceKinds.length !== sourceRefs.length) {
    throw new Error(
      `robin:source-kind/source-ref cardinality mismatch: ${sourceKinds.length} != ${sourceRefs.length}`,
    );
  }
  if (new Set(sourceRefs).size !== sourceRefs.length) {
    throw new Error("robin:source-ref values must be unique");
  }
  const legacySources = [
    ...toStringArray(frontmatter.source),
    ...toStringArray(frontmatter.sources),
  ];
  if (version === "0.3" && legacySources.length > 0) {
    throw new Error(
      "Robin v0.3 pages cannot use legacy frontmatter.source/sources; migrate them to paired source_kinds/source_refs",
    );
  }

  const rawType = (frontmatter.type as string | undefined)?.toString() || "note";
  const meta: RobinMeta = {
    version,
    id,
    slug,
    path: outputPath,
    type: rawType,
    updated:
      normalizeDate(frontmatter.updated) ??
      normalizeDate(updated) ??
      new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    created: normalizeDate(frontmatter.created),
    summary: (frontmatter.summary as string | undefined) ?? undefined,
    // 'status' and 'state' are the same lifecycle field in the current vault.
    // `status` is now the CANONICAL key on both read and write (the on-disk
    // convention: 49 task pages stamp `robin:status`). On input we accept both
    // keys, with `status` winning; on output `metaTagsForHead` emits a single
    // `robin:status` tag. `state` is preserved verbatim only so a legacy
    // `state:`-keyed source re-saves losslessly — but it converges to
    // `robin:status` on the next write.
    status: (frontmatter.status as string | undefined) ?? (frontmatter.state as string | undefined),
    state: (frontmatter.state as string | undefined) ?? (frontmatter.status as string | undefined),
    owner: (frontmatter.owner as string | undefined) ?? undefined,
    priority: (frontmatter.priority as string | undefined) ?? undefined,
    size: normalizeSize(frontmatter.size),
    due: normalizeDate(frontmatter.due),
    // Date-only schedule window (timeline bars). Normalized like `due`.
    start: normalizeDate(frontmatter.start),
    end: normalizeDate(frontmatter.end),
    project: (frontmatter.project as string | undefined) ?? undefined,
    next_action: (frontmatter.next_action as string | undefined) ?? undefined,
    acceptance: (frontmatter.acceptance as string | undefined) ?? undefined,
    category: (frontmatter.category as string | undefined) ?? undefined,
    kind: normalizeTaskKind(frontmatter.kind),
    parent: (frontmatter.parent as string | undefined)?.toString().trim() || undefined,
    // `planned` keeps its hour (an absolute instant), unlike date-only `due`.
    planned: normalizeDate(frontmatter.planned),
    role: (frontmatter.role as string | undefined) ?? undefined,
    relationship: (frontmatter.relationship as string | undefined) ?? undefined,
    started: normalizeDate(frontmatter.started),
    date: normalizeDate(frontmatter.date),
    duration: (frontmatter.duration as string | undefined) ?? undefined,
    tier: (frontmatter.tier as string | undefined) ?? undefined,
    tags: toStringArray(frontmatter.tags),
    attendees: toStringArray(frontmatter.attendees),
    sources: sourceRefs.length > 0 ? sourceRefs : legacySources,
    sourceKinds: sourceKinds.length > 0 ? sourceKinds : undefined,
    sourceRefs: sourceRefs.length > 0 ? sourceRefs : undefined,
    unknownKeys: Object.keys(frontmatter).filter((k) => !KNOWN_KEYS.has(k)),
  };

  // Raw stores the ORIGINAL frontmatter verbatim for lossless round-trip.
  // We do NOT trust this for indexing — meta is authoritative.
  const raw: Record<string, unknown> = { ...frontmatter };
  // Add title to raw if it wasn't there but we derived it
  if (!raw.title && title) raw.title = title;

  return { raw, meta };
}

/**
 * Emit the <head> meta tags for a RobinMeta object.
 * Returns an array of [name, content] pairs in canonical order
 * (sorted by name, then by content for repeated keys).
 */
export function metaTagsForHead(meta: RobinMeta): Array<[string, string]> {
  const tags: Array<[string, string]> = [];
  const push = (name: string, content?: string) => {
    if (content !== undefined && content !== null && content !== "") {
      tags.push([name, String(content)]);
    }
  };

  push("robin:version", meta.version);
  push("robin:id", meta.id);
  push("robin:slug", meta.slug);
  push("robin:path", meta.path);
  push("robin:type", meta.type);
  push("robin:updated", meta.updated);
  push("robin:created", meta.created);
  push("robin:summary", meta.summary);
  // Canonical emit key is `robin:status` — it matches the on-disk vault
  // convention (task pages stamp `robin:status`). `state` is a synonym folded
  // into `status` by normalizeFrontmatter, so we emit a single `robin:status`
  // tag and never a separate `robin:state` (that would duplicate the value).
  // On read, both keys are accepted (read-page.buildMeta + extractMeta), so a
  // legacy `robin:state` page still resolves and converges to `robin:status`
  // the next time it is saved through this writer.
  push("robin:status", meta.status ?? meta.state);
  push("robin:owner", meta.owner);
  push("robin:priority", meta.priority);
  push("robin:size", meta.size !== undefined ? String(meta.size) : undefined);
  push("robin:due", meta.due);
  push("robin:start", meta.start);
  push("robin:end", meta.end);
  push("robin:project", meta.project);
  push("robin:next_action", meta.next_action);
  push("robin:acceptance", meta.acceptance);
  push("robin:category", meta.category);
  push("robin:kind", meta.kind);
  push("robin:parent", meta.parent);
  push("robin:planned", meta.planned);
  push("robin:role", meta.role);
  push("robin:relationship", meta.relationship);
  push("robin:started", meta.started);
  push("robin:date", meta.date);
  push("robin:duration", meta.duration);
  push("robin:tier", meta.tier);
  for (const tag of [...meta.tags].sort()) push("robin:tag", tag);
  for (const att of [...meta.attendees].sort()) push("robin:attendee", att);
  const typedSources = typedSourcePairs(meta);
  if (typedSources.length === 0) {
    for (const src of [...meta.sources].sort()) push("robin:source", src);
  }

  // Canonical order for scalar and independently-repeatable fields.
  tags.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });

  // Typed provenance is an ordered pair. Sort PAIRS, then append each kind/ref
  // together; independently sorting these two repeated keys would corrupt their
  // positional relationship.
  for (const source of typedSources) {
    tags.push(["robin:source-kind", source.kind]);
    tags.push(["robin:source-ref", source.ref]);
  }
  return tags;
}

function typedSourcePairs(meta: RobinMeta): Array<{ kind: RobinSourceKind; ref: string }> {
  const kinds = meta.sourceKinds ?? [];
  const refs = meta.sourceRefs ?? [];
  if (kinds.length !== refs.length) {
    throw new Error(
      `robin:source-kind/source-ref cardinality mismatch: ${kinds.length} != ${refs.length}`,
    );
  }
  return kinds
    .map((kind, index) => {
      const ref = refs[index];
      if (!ref) throw new Error(`missing robin:source-ref at index ${index}`);
      return { kind, ref };
    })
    .sort((a, b) => (a.ref !== b.ref ? a.ref.localeCompare(b.ref) : a.kind.localeCompare(b.kind)));
}

/**
 * Lossless canonical frontmatter projection used by read-modify-write tools.
 * Keeping this in the converter prevents each writer from forgetting newly
 * promoted metadata (especially v0.3 identity and typed provenance).
 */
export function frontmatterFromMeta(meta: RobinMeta): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    version: meta.version,
    type: meta.type,
  };
  const set = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "") raw[key] = value;
  };

  set("id", meta.id);
  set("summary", meta.summary);
  set("status", meta.status ?? meta.state);
  set("owner", meta.owner);
  set("priority", meta.priority);
  set("size", meta.size);
  set("due", meta.due);
  set("start", meta.start);
  set("end", meta.end);
  set("project", meta.project);
  set("next_action", meta.next_action);
  set("acceptance", meta.acceptance);
  set("category", meta.category);
  set("kind", meta.kind);
  set("parent", meta.parent);
  set("planned", meta.planned);
  set("role", meta.role);
  set("relationship", meta.relationship);
  set("started", meta.started);
  set("date", meta.date);
  set("duration", meta.duration);
  set("tier", meta.tier);
  if (meta.created) raw.created = meta.created;
  if (meta.tags.length > 0) raw.tags = [...meta.tags];
  if (meta.attendees.length > 0) raw.attendees = [...meta.attendees];
  if (meta.sourceKinds?.length || meta.sourceRefs?.length) {
    raw.source_kinds = [...(meta.sourceKinds ?? [])];
    raw.source_refs = [...(meta.sourceRefs ?? [])];
  } else if (meta.sources.length > 0) {
    raw.sources = [...meta.sources];
  }
  return raw;
}
