import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalizeHtml, parseRobinHtmlCore, type RobinMeta } from "@robin/converter";
import { VaultConflictError, writeWithHistory, type EditEvent } from "@robin/vault-io";
import { refreshIndexPaths } from "./indexer-client";
import { vaultPageHref } from "./routes";

export type CommitmentLifecycle =
  | "active"
  | "fulfilled"
  | "missed"
  | "cancelled"
  | "superseded"
  | "dismissed";

export type CommitmentAuthority = "tentative" | "reported" | "confirmed";

export interface WatchedCommitment {
  id: string;
  path: string;
  href: string;
  statement: string;
  owner: string;
  due: string;
  evidenceState: CommitmentAuthority;
  reason: string;
  sourceHref?: string;
}

export type MeaningfulChangeKind =
  | "commitment-created"
  | "commitment-confirmed"
  | "owner-changed"
  | "checkpoint-changed"
  | "fulfilled"
  | "missed"
  | "cancelled"
  | "superseded"
  | "dismissed"
  | "decision-confirmed";

export interface MeaningfulChange {
  id: string;
  path: string;
  href: string;
  kind: MeaningfulChangeKind;
  summary: string;
  at: string;
}

export interface FollowThroughSnapshot {
  watching: WatchedCommitment[];
  changes: MeaningfulChange[];
  historyAvailable: boolean;
}

interface CommitmentRecord {
  id: string;
  path: string;
  statement: string;
  owner?: string;
  due?: string;
  lifecycle: CommitmentLifecycle;
  authority: CommitmentAuthority;
  reviewState: "tentative" | "confirmed";
  health: string;
  sourcePath?: string;
  sourceRevision?: string;
}

interface InterventionRef {
  path: string;
  commitmentPath?: string;
  status: string;
  kind: string;
}

interface EditStream {
  available: boolean;
  events: EditEvent[];
}

const TERMINAL_LIFECYCLES = new Set<CommitmentLifecycle>([
  "fulfilled",
  "missed",
  "cancelled",
  "superseded",
  "dismissed",
]);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getMeta(html: string, name: string): string | undefined {
  return parseRobinHtmlCore(html).metaMap[name]?.[0];
}

function lifecycleFrom(html: string): CommitmentLifecycle {
  const parsed = parseRobinHtmlCore(html);
  const explicit = parsed.metaMap["robin:lifecycle"]?.[0];
  if (explicit === "active" || TERMINAL_LIFECYCLES.has(explicit as CommitmentLifecycle)) {
    return explicit as CommitmentLifecycle;
  }
  const status =
    parsed.metaMap["robin:status"]?.[0] ?? parsed.metaMap["robin:state"]?.[0] ?? "active";
  if (status === "done" || status === "completed" || status === "fulfilled") return "fulfilled";
  if (status === "missed") return "missed";
  if (status === "cancelled") return "cancelled";
  if (status === "superseded") return "superseded";
  if (status === "dismissed" || status === "closed" || status === "archived") return "dismissed";
  return "active";
}

function authorityFrom(html: string): CommitmentAuthority {
  const parsed = parseRobinHtmlCore(html);
  const evidence = parsed.metaMap["robin:evidence-state"]?.[0];
  if (evidence === "reported" || evidence === "confirmed") return evidence;
  if (evidence === "inferred" || evidence === "tentative") return "tentative";
  const status = parsed.metaMap["robin:status"]?.[0];
  return status === "confirmed" ? "confirmed" : status === "tentative" ? "tentative" : "reported";
}

function commitmentFromHtml(relPath: string, html: string): CommitmentRecord | null {
  const parsed = parseRobinHtmlCore(html);
  if (parsed.metaMap["robin:type"]?.[0] !== "commitment") return null;
  const authority = authorityFrom(html);
  const review = parsed.metaMap["robin:review-state"]?.[0];
  return {
    id: parsed.metaMap["robin:record-id"]?.[0] ?? path.basename(relPath, ".html"),
    path: relPath,
    statement: parsed.title || path.basename(relPath, ".html").replace(/[-_]+/g, " "),
    owner: parsed.metaMap["robin:owner"]?.[0],
    due: parsed.metaMap["robin:due"]?.[0] ?? parsed.metaMap["robin:next-check"]?.[0],
    lifecycle: lifecycleFrom(html),
    authority,
    reviewState: review === "tentative" || authority === "tentative" ? "tentative" : "confirmed",
    health: parsed.metaMap["robin:health"]?.[0] ?? "unknown",
    sourcePath: parsed.metaMap["robin:meeting"]?.[0],
    sourceRevision: parsed.metaMap["robin:source-revision"]?.[0],
  };
}

async function walkHtml(root: string, rel = ""): Promise<string[]> {
  const dir = path.join(root, rel);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const child = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...(await walkHtml(root, child)));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(child);
  }
  return files;
}

async function readCommitments(
  vault: string,
): Promise<Array<{ record: CommitmentRecord; html: string }>> {
  const root = path.join(/*turbopackIgnore: true*/ vault, "brain", "commitments");
  const records: Array<{ record: CommitmentRecord; html: string }> = [];
  for (const child of await walkHtml(root)) {
    const relPath = path.posix.join("brain", "commitments", child.split(path.sep).join("/"));
    const html = await fs.readFile(path.join(root, child), "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    if (!html) continue;
    const record = commitmentFromHtml(relPath, html);
    if (record) records.push({ record, html });
  }
  return records;
}

async function readInterventionRefs(vault: string): Promise<InterventionRef[]> {
  const root = path.join(/*turbopackIgnore: true*/ vault, "brain", "interventions");
  const refs: InterventionRef[] = [];
  for (const child of await walkHtml(root)) {
    const relPath = path.posix.join("brain", "interventions", child.split(path.sep).join("/"));
    const html = await fs.readFile(path.join(root, child), "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    if (!html || getMeta(html, "robin:type") !== "intervention") continue;
    refs.push({
      path: relPath,
      commitmentPath: getMeta(html, "robin:commitment"),
      status: getMeta(html, "robin:status") ?? "open",
      kind: getMeta(html, "robin:kind") ?? "unknown",
    });
  }
  return refs;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validDateOnly(value?: string): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function checkpointLabel(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function checkpointInterventionHtml(input: {
  path: string;
  slug: string;
  commitment: CommitmentRecord;
  commitmentHash: string;
  now: Date;
}): string {
  const updated = input.now.toISOString();
  const due = input.commitment.due!;
  const owner = input.commitment.owner!;
  const summary = `${owner}'s ${checkpointLabel(due)} checkpoint passed without a recorded outcome.`;
  const meta: RobinMeta = {
    version: "0.2",
    path: input.path,
    slug: input.slug,
    type: "intervention",
    status: "open",
    updated,
    summary,
    sources: [
      input.commitment.path,
      ...(input.commitment.sourcePath ? [input.commitment.sourcePath] : []),
    ],
    tags: ["follow-through"],
    attendees: [],
    unknownKeys: [],
  };
  return canonicalizeHtml({
    meta,
    frontmatter: { title: `What happened with: ${input.commitment.statement}?` },
    blocks: [],
    updatedAt: input.now,
    extraMeta: [
      ["robin:generated-by", "follow-through"],
      ["robin:record-id", input.slug],
      ["robin:kind", "commitment-checkpoint"],
      ["robin:evidence-state", "stale"],
      ["robin:commitment", input.commitment.path],
      ["robin:target", input.commitment.path],
      ["robin:target-title", input.commitment.statement],
      ["robin:target-hash", input.commitmentHash],
      ["robin:why-now", summary],
      [
        "robin:belief",
        `Robin has no fresh evidence that ${owner}'s promise was kept, missed, or released.`,
      ],
      ["robin:recommended-action", "Record outcome"],
      ["robin:owner", owner],
      ["robin:due", due],
      ...(input.commitment.sourcePath
        ? [["robin:meeting", input.commitment.sourcePath] as [string, string]]
        : []),
      ...(input.commitment.sourceRevision
        ? [["robin:source-revision", input.commitment.sourceRevision] as [string, string]]
        : []),
    ],
    bodyHtml: [
      `<h1 data-block="heading">What happened with: ${escapeHtml(input.commitment.statement)}?</h1>`,
      `<p data-block="paragraph">${escapeHtml(summary)}</p>`,
      '<p data-block="paragraph">Silence is not evidence of progress. Record the outcome so Robin can carry the right belief forward.</p>',
      `<p data-block="paragraph">Commitment: <a href="${escapeHtml(vaultPageHref(input.commitment.path))}">${escapeHtml(input.commitment.statement)}</a>.</p>`,
    ].join("\n"),
  });
}

/** Materialize passed checkpoints as durable interventions. Safe to call on every Today read. */
export async function ensureCommitmentCheckpointInterventions(
  vault: string,
  now = new Date(),
): Promise<string[]> {
  const commitments = await readCommitments(vault);
  const refs = await readInterventionRefs(vault);
  const openCommitments = new Set(
    refs
      .filter((ref) => ref.status === "open" && ref.commitmentPath)
      .map((ref) => ref.commitmentPath!),
  );
  const knownPaths = new Set(refs.map((ref) => ref.path));
  const today = localDateKey(now);
  const created: string[] = [];

  for (const { record, html } of commitments) {
    if (
      record.lifecycle !== "active" ||
      record.reviewState !== "confirmed" ||
      !record.owner ||
      !validDateOnly(record.due) ||
      record.due >= today ||
      openCommitments.has(record.path)
    )
      continue;

    const slug = `${path.basename(record.path, ".html")}-checkpoint`;
    const interventionPath = path.posix.join("brain", "interventions", `${slug}.html`);
    if (knownPaths.has(interventionPath)) continue;
    try {
      const result = await writeWithHistory({
        absolutePath: path.join(/*turbopackIgnore: true*/ vault, interventionPath),
        html: checkpointInterventionHtml({
          path: interventionPath,
          slug,
          commitment: record,
          commitmentHash: crypto.createHash("sha256").update(html, "utf8").digest("hex"),
          now,
        }),
        origin: "agent",
        tool: "follow-through",
        vaultRoot: vault,
        summary: "Raise a passed commitment checkpoint",
        expectedHash: null,
      });
      if (result.written) created.push(interventionPath);
    } catch (error) {
      // A parallel Today read may win the same create-only CAS. The path is
      // deterministic, so an occupied destination is the expected idempotent
      // outcome; every other failure still surfaces.
      if (!(error instanceof VaultConflictError)) throw error;
    }
    knownPaths.add(interventionPath);
    openCommitments.add(record.path);
  }
  if (created.length > 0) {
    await refreshIndexPaths(created).catch((error) => {
      console.warn("[follow-through] checkpoints committed but index refresh failed:", error);
    });
  }
  return created;
}

async function readEditStream(vault: string): Promise<EditStream> {
  const dir = path.join(/*turbopackIgnore: true*/ vault, "inbox", "robin", "edits");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { available: false, events: [] };
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const events: EditEvent[] = [];
  let available = true;
  for (const file of files) {
    const content = await fs.readFile(path.join(dir, file), "utf8").catch(() => null);
    if (content === null) {
      available = false;
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as EditEvent);
      } catch {
        available = false;
      }
    }
  }
  return { available, events };
}

async function readSnapshot(vault: string, relPath?: string): Promise<string | null> {
  if (
    !relPath ||
    !relPath.startsWith(".history/") ||
    relPath.includes("..") ||
    relPath.includes("\0")
  )
    return null;
  return fs.readFile(path.join(/*turbopackIgnore: true*/ vault, relPath), "utf8").catch(() => null);
}

function sameCommitment(a: CommitmentRecord, b: CommitmentRecord): boolean {
  return (
    a.statement === b.statement &&
    a.owner === b.owner &&
    a.due === b.due &&
    a.lifecycle === b.lifecycle &&
    a.authority === b.authority &&
    a.reviewState === b.reviewState &&
    a.health === b.health
  );
}

function commitmentChange(
  event: EditEvent,
  beforeHtml: string,
  afterHtml: string,
): MeaningfulChange | null {
  const after = commitmentFromHtml(event.page_path, afterHtml);
  if (!after) return null;
  const before = beforeHtml ? commitmentFromHtml(event.page_path, beforeHtml) : null;
  if (!before) {
    const checkpoint = after.due ? ` Robin will check back ${checkpointLabel(after.due)}.` : "";
    return {
      id: event.id,
      path: event.page_path,
      href: vaultPageHref(event.page_path),
      kind: "commitment-created",
      summary: `Started carrying ${after.owner ? `${after.owner}'s promise to ` : ""}${after.statement}.${checkpoint}`,
      at: event.ts,
    };
  }
  if (sameCommitment(before, after)) return null;

  let kind: MeaningfulChangeKind;
  let summary: string;
  if (before.lifecycle !== after.lifecycle && after.lifecycle !== "active") {
    kind = after.lifecycle;
    const labels: Record<Exclude<CommitmentLifecycle, "active">, string> = {
      fulfilled: "was kept",
      missed: "was missed",
      cancelled: "was released",
      superseded: "was replaced",
      dismissed: "was dismissed",
    };
    summary = `${after.owner ? `${after.owner}'s promise to ` : ""}${after.statement} ${labels[after.lifecycle]}.`;
  } else if (before.authority !== after.authority && after.authority === "confirmed") {
    kind = "commitment-confirmed";
    summary = `Confirmed ${after.owner ? `${after.owner}'s promise to ` : ""}${after.statement}.`;
  } else if (before.owner !== after.owner) {
    kind = "owner-changed";
    summary = `${after.statement} now belongs to ${after.owner ?? "an unconfirmed owner"}.`;
  } else if (before.due !== after.due) {
    kind = "checkpoint-changed";
    summary = `${after.statement} now comes back ${after.due ? checkpointLabel(after.due) : "without a checkpoint"}.`;
  } else {
    return null;
  }
  return {
    id: event.id,
    path: event.page_path,
    href: vaultPageHref(event.page_path),
    kind,
    summary,
    at: event.ts,
  };
}

function decisionChange(
  event: EditEvent,
  beforeHtml: string,
  afterHtml: string,
): MeaningfulChange | null {
  if (beforeHtml) return null;
  const parsed = parseRobinHtmlCore(afterHtml);
  if (
    parsed.metaMap["robin:type"]?.[0] !== "decision" ||
    parsed.metaMap["robin:generated-by"]?.[0] !== "intervention-resolution"
  )
    return null;
  const subject = parsed.metaMap["robin:subject"]?.[0] ?? parsed.title;
  const value = parsed.metaMap["robin:selected-value"]?.[0];
  return {
    id: event.id,
    path: event.page_path,
    href: vaultPageHref(event.page_path),
    kind: "decision-confirmed",
    summary: value ? `${subject} is now ${value}.` : `Confirmed ${subject}.`,
    at: event.ts,
  };
}

async function meaningfulChanges(
  vault: string,
  now: Date,
): Promise<{ items: MeaningfulChange[]; available: boolean }> {
  const stream = await readEditStream(vault);
  const relevant = stream.events.filter(
    (event) =>
      event.page_path.startsWith("brain/commitments/") ||
      event.page_path.startsWith("brain/decisions/"),
  );
  const byPage = new Map<string, EditEvent[]>();
  for (const event of relevant)
    byPage.set(event.page_path, [...(byPage.get(event.page_path) ?? []), event]);
  const changes: MeaningfulChange[] = [];
  let available = stream.available;

  for (const events of byPage.values()) {
    const ascending = events
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.ts.localeCompare(b.event.ts) || a.index - b.index)
      .map((item) => item.event);
    for (let index = 0; index < ascending.length; index += 1) {
      const event = ascending[index]!;
      let before = "";
      if (event.before_hash) {
        const snapshot = await readSnapshot(vault, event.snapshot);
        if (snapshot === null) {
          available = false;
          continue;
        }
        before = snapshot;
      }

      const next = ascending[index + 1];
      let after: string | null;
      if (next) {
        after = await readSnapshot(vault, next.snapshot);
      } else {
        after = await fs
          .readFile(path.join(/*turbopackIgnore: true*/ vault, event.page_path), "utf8")
          .catch(() => null);
      }
      if (after === null) {
        available = false;
        continue;
      }
      const change = event.page_path.startsWith("brain/commitments/")
        ? commitmentChange(event, before, after)
        : decisionChange(event, before, after);
      if (change) changes.push(change);
    }
  }

  const recentBoundary = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return {
    items: changes
      .filter((change) => {
        const timestamp = new Date(change.at).getTime();
        return Number.isNaN(timestamp) || timestamp >= recentBoundary;
      })
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 3),
    available,
  };
}

export async function loadFollowThrough(
  vault: string,
  now = new Date(),
): Promise<FollowThroughSnapshot> {
  const [commitments, refs, changes] = await Promise.all([
    readCommitments(vault),
    readInterventionRefs(vault),
    meaningfulChanges(vault, now),
  ]);
  const openCommitments = new Set(
    refs
      .filter((ref) => ref.status === "open" && ref.commitmentPath)
      .map((ref) => ref.commitmentPath!),
  );
  const today = localDateKey(now);
  const watching = commitments
    .map((item) => item.record)
    .filter(
      (record) =>
        record.lifecycle === "active" &&
        record.reviewState === "confirmed" &&
        Boolean(record.owner) &&
        validDateOnly(record.due) &&
        record.due >= today &&
        !openCommitments.has(record.path),
    )
    .sort((a, b) => a.due!.localeCompare(b.due!) || a.statement.localeCompare(b.statement))
    .slice(0, 3)
    .map<WatchedCommitment>((record) => ({
      id: record.id,
      path: record.path,
      href: vaultPageHref(record.path),
      statement: record.statement,
      owner: record.owner!,
      due: record.due!,
      evidenceState: record.authority,
      reason: `No exception is recorded. Robin will bring this back at the ${checkpointLabel(record.due!)} checkpoint.`,
      sourceHref: record.sourcePath ? vaultPageHref(record.sourcePath) : undefined,
    }));

  return { watching, changes: changes.items, historyAvailable: changes.available };
}
