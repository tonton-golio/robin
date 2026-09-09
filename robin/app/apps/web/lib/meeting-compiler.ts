import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalizeHtml, parseRobinHtmlCore, type RobinMeta } from "@robin/converter";
import { VaultConflictError, writeWithHistory } from "@robin/vault-io";
import { vaultPageHref } from "./routes";
import type {
  MeetingCommitmentSignal,
  MeetingConflictSignal,
  MeetingDecisionSignal,
  MeetingSignals,
} from "./meeting-signals";

export interface CompiledArtifact {
  path: string;
  written: boolean;
}

export interface MeetingCompileReceipt {
  decisions: CompiledArtifact[];
  commitments: CompiledArtifact[];
  interventions: CompiledArtifact[];
  receipt: CompiledArtifact;
}

export interface CompileMeetingInput {
  vault: string;
  meetingId: string;
  sourcePath: string;
  sourceRevision: string;
  meetingPath: string;
  meetingSlug: string;
  meetingTitle: string;
  meetingDate: string;
  sourceUpdated: string;
  signals: MeetingSignals;
}

interface ConflictTarget {
  path: string;
  title: string;
  /** Exact bytes found in the HTML file, which may be entity-escaped. */
  needle: string;
  hash: string;
}

function occurrenceCount(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

const TERMINAL_INTERVENTION_STATUSES = new Set(["resolved", "dismissed"]);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function validUpdatedAt(value: string): Date {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function pageMeta(input: {
  path: string;
  slug: string;
  type: string;
  status: string;
  summary: string;
  sourceUpdated: string;
  owner?: string | null;
  due?: string | null;
  sources: string[];
}): RobinMeta {
  return {
    version: "0.2",
    path: input.path,
    slug: input.slug,
    type: input.type,
    status: input.status,
    updated: input.sourceUpdated,
    summary: input.summary,
    owner: input.owner || undefined,
    due: input.due || undefined,
    sources: input.sources,
    tags: ["meeting-compiled"],
    attendees: [],
    unknownKeys: [],
  };
}

function buildArtifactHtml(input: {
  path: string;
  slug: string;
  type: string;
  status: string;
  title: string;
  summary: string;
  sourceUpdated: string;
  owner?: string | null;
  due?: string | null;
  sources: string[];
  extraMeta?: Array<[string, string]>;
  bodyHtml: string;
}): string {
  return canonicalizeHtml({
    meta: pageMeta(input),
    frontmatter: { title: input.title },
    blocks: [],
    bodyHtml: input.bodyHtml,
    updatedAt: validUpdatedAt(input.sourceUpdated),
    extraMeta: [
      ["robin:generated-by", "meeting-compiler"],
      ["robin:record-id", input.slug],
      ...(input.extraMeta ?? []),
    ],
  });
}

function sourceBody(input: CompileMeetingInput): string {
  return `<p data-block="paragraph">Evidence: <a href="${escapeHtml(vaultPageHref(input.meetingPath))}">${escapeHtml(input.meetingTitle)}</a>.</p>`;
}

function decisionHtml(
  input: CompileMeetingInput,
  signal: MeetingDecisionSignal,
  artifactPath: string,
  slug: string,
): string {
  return buildArtifactHtml({
    path: artifactPath,
    slug,
    type: "decision",
    status: signal.evidenceState === "inferred" ? "tentative" : "reported",
    title: signal.text,
    summary: `Meeting decision from ${input.meetingTitle}.`,
    sourceUpdated: input.sourceUpdated,
    sources: [input.meetingPath, input.sourcePath],
    extraMeta: [
      ["robin:evidence-state", signal.evidenceState],
      ["robin:meeting", input.meetingPath],
      ["robin:meeting-id", input.meetingId],
      ["robin:source-item-id", signal.id],
      ["robin:source-revision", input.sourceRevision],
    ],
    bodyHtml: [
      `<h1 data-block="heading">${escapeHtml(signal.text)}</h1>`,
      `<p data-block="paragraph"><strong>Evidence state:</strong> ${escapeHtml(signal.evidenceState)}.</p>`,
      sourceBody(input),
    ].join("\n"),
  });
}

function commitmentHtml(
  input: CompileMeetingInput,
  signal: MeetingCommitmentSignal,
  artifactPath: string,
  slug: string,
): string {
  const isTentative = signal.evidenceState === "inferred" || !signal.owner || !signal.due;
  const context = [
    signal.owner
      ? `<strong>Owner:</strong> ${escapeHtml(signal.owner)}`
      : "<strong>Owner:</strong> needs confirmation",
    signal.due
      ? `<strong>Checkpoint:</strong> ${escapeHtml(signal.due)}`
      : "<strong>Checkpoint:</strong> needs confirmation",
  ].join(" · ");
  return buildArtifactHtml({
    path: artifactPath,
    slug,
    type: "commitment",
    // Authority, lifecycle, and health are deliberately separate. A promise
    // can be confirmed and still be active; silence is never "on track".
    status: "active",
    title: signal.text,
    summary: `Meeting commitment from ${input.meetingTitle}.`,
    sourceUpdated: input.sourceUpdated,
    owner: signal.owner,
    due: signal.due,
    sources: [input.meetingPath, input.sourcePath],
    extraMeta: [
      ["robin:evidence-state", signal.evidenceState],
      ["robin:review-state", isTentative ? "tentative" : "confirmed"],
      ["robin:lifecycle", "active"],
      ["robin:health", "unknown"],
      ...(signal.due ? [["robin:next-check", signal.due] as [string, string]] : []),
      ["robin:meeting", input.meetingPath],
      ["robin:meeting-id", input.meetingId],
      ["robin:source-item-id", signal.id],
      ["robin:source-revision", input.sourceRevision],
    ],
    bodyHtml: [
      `<h1 data-block="heading">${escapeHtml(signal.text)}</h1>`,
      `<p data-block="paragraph">${context}.</p>`,
      `<p data-block="paragraph"><strong>Evidence state:</strong> ${escapeHtml(signal.evidenceState)}.</p>`,
      sourceBody(input),
    ].join("\n"),
  });
}

function conflictInterventionHtml(
  input: CompileMeetingInput,
  signal: MeetingConflictSignal,
  artifactPath: string,
  slug: string,
  target: ConflictTarget | null,
): string {
  const targetText = target
    ? `Robin found ${signal.existingValue} in ${target.title}.`
    : `Robin could not identify one safe page to update automatically.`;
  return buildArtifactHtml({
    path: artifactPath,
    slug,
    type: "intervention",
    status: "open",
    title: signal.question,
    summary: `${signal.existingValue} conflicts with ${signal.proposedValue} for ${signal.subject}.`,
    sourceUpdated: input.sourceUpdated,
    sources: [input.meetingPath, input.sourcePath],
    extraMeta: [
      ["robin:kind", "conflict"],
      ["robin:evidence-state", "conflicting"],
      ["robin:subject", signal.subject],
      ["robin:existing-value", signal.existingValue],
      ["robin:proposed-value", signal.proposedValue],
      ["robin:question", signal.question],
      [
        "robin:why-now",
        `The reviewed meeting conflicts with Robin's current record for ${signal.subject}.`,
      ],
      [
        "robin:belief",
        `${signal.proposedValue} is the newer reported value, but it is not authoritative until you choose.`,
      ],
      ["robin:recommended-action", `Use ${signal.proposedValue}`],
      ["robin:meeting", input.meetingPath],
      ["robin:meeting-id", input.meetingId],
      ["robin:source-item-id", signal.id],
      ["robin:source-revision", input.sourceRevision],
      ...(target
        ? [
            ["robin:target", target.path] as [string, string],
            ["robin:target-title", target.title] as [string, string],
            ["robin:target-match", target.needle] as [string, string],
            ["robin:target-hash", target.hash] as [string, string],
          ]
        : []),
    ],
    bodyHtml: [
      `<h1 data-block="heading">${escapeHtml(signal.question)}</h1>`,
      `<p data-block="paragraph"><strong>Conflicting evidence:</strong> current record says ${escapeHtml(signal.existingValue)}; the meeting says ${escapeHtml(signal.proposedValue)}.</p>`,
      `<p data-block="paragraph">${escapeHtml(targetText)}</p>`,
      sourceBody(input),
    ].join("\n"),
  });
}

function commitmentInterventionHtml(
  input: CompileMeetingInput,
  signal: MeetingCommitmentSignal,
  commitmentPath: string,
  artifactPath: string,
  slug: string,
): string {
  const gaps = [!signal.owner ? "owner" : null, !signal.due ? "checkpoint" : null]
    .filter(Boolean)
    .join(" and ");
  const why =
    signal.evidenceState === "inferred"
      ? "Robin inferred a commitment rather than hearing an explicit promise."
      : `The commitment has no confirmed ${gaps}.`;
  return buildArtifactHtml({
    path: artifactPath,
    slug,
    type: "intervention",
    status: "open",
    title: `Confirm commitment: ${signal.text}`,
    summary: why,
    sourceUpdated: input.sourceUpdated,
    sources: [input.meetingPath, input.sourcePath, commitmentPath],
    extraMeta: [
      ["robin:kind", "commitment-confirmation"],
      ["robin:evidence-state", signal.evidenceState],
      ["robin:commitment", commitmentPath],
      ["robin:why-now", why],
      [
        "robin:belief",
        `${signal.owner ?? "Someone"} may have committed to ${signal.text}, but Robin should not promote it silently.`,
      ],
      ["robin:recommended-action", "Confirm"],
      ["robin:meeting", input.meetingPath],
      ["robin:meeting-id", input.meetingId],
      ["robin:source-item-id", signal.id],
      ["robin:source-revision", input.sourceRevision],
    ],
    bodyHtml: [
      `<h1 data-block="heading">Confirm commitment: ${escapeHtml(signal.text)}</h1>`,
      `<p data-block="paragraph"><strong>Tentative:</strong> ${escapeHtml(why)}</p>`,
      sourceBody(input),
    ].join("\n"),
  });
}

function decisionInterventionHtml(
  input: CompileMeetingInput,
  signal: MeetingDecisionSignal,
  decisionPath: string,
  artifactPath: string,
  slug: string,
): string {
  return buildArtifactHtml({
    path: artifactPath,
    slug,
    type: "intervention",
    status: "open",
    title: `Confirm decision: ${signal.text}`,
    summary: "Robin inferred a decision rather than hearing an explicit decision statement.",
    sourceUpdated: input.sourceUpdated,
    sources: [input.meetingPath, input.sourcePath, decisionPath],
    extraMeta: [
      ["robin:kind", "decision-confirmation"],
      ["robin:evidence-state", signal.evidenceState],
      ["robin:decision", decisionPath],
      [
        "robin:why-now",
        "Robin inferred a decision rather than hearing an explicit decision statement.",
      ],
      [
        "robin:belief",
        `${signal.text} may be the intended decision, but Robin should not promote it silently.`,
      ],
      ["robin:recommended-action", "Confirm"],
      ["robin:meeting", input.meetingPath],
      ["robin:meeting-id", input.meetingId],
      ["robin:source-item-id", signal.id],
      ["robin:source-revision", input.sourceRevision],
    ],
    bodyHtml: [
      `<h1 data-block="heading">Confirm decision: ${escapeHtml(signal.text)}</h1>`,
      '<p data-block="paragraph"><strong>Tentative:</strong> the meeting implies this decision but does not state it explicitly.</p>',
      sourceBody(input),
    ].join("\n"),
  });
}

async function walkHtmlFiles(root: string, rel = ""): Promise<string[]> {
  const dir = path.join(/*turbopackIgnore: true*/ root, rel);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await walkHtmlFiles(root, childRel)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(childRel);
    }
  }
  return files;
}

async function locateConflictTarget(
  vault: string,
  existingValue: string,
): Promise<ConflictTarget | null> {
  const brain = path.join(/*turbopackIgnore: true*/ vault, "brain");
  const candidates: ConflictTarget[] = [];
  const escapedNeedle = escapeHtml(existingValue);
  for (const rel of await walkHtmlFiles(brain)) {
    const absolutePath = path.join(/*turbopackIgnore: true*/ brain, rel);
    const html = await fs.readFile(absolutePath, "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    const parsed = parseRobinHtmlCore(html);
    // Reconciliation may use durable human/confirmed decision pages as truth,
    // but must not discover the same meeting-generated claim it is currently
    // trying to reconcile (or another intervention quoting that claim).
    if (
      parsed.metaMap["robin:type"]?.[0] === "intervention" ||
      parsed.metaMap["robin:generated-by"]?.[0] === "meeting-compiler"
    )
      continue;
    const needle = html.includes(existingValue)
      ? existingValue
      : escapedNeedle !== existingValue && html.includes(escapedNeedle)
        ? escapedNeedle
        : null;
    if (!needle) continue;
    // An approved rewrite is only safe when one exact occurrence can be
    // replaced. Multiple occurrences stay a judgment without an auto-target.
    if (occurrenceCount(html, needle) !== 1) continue;
    candidates.push({
      path: path.posix.join("brain", rel.split(path.sep).join("/")),
      title: parsed.title || path.basename(rel, ".html").replace(/[-_]+/g, " "),
      needle,
      hash: crypto.createHash("sha256").update(html, "utf8").digest("hex"),
    });
  }
  return candidates.length === 1 ? candidates[0]! : null;
}

async function currentStatus(absolutePath: string): Promise<string | null> {
  const html = await fs.readFile(absolutePath, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
  if (!html) return null;
  const parsed = parseRobinHtmlCore(html);
  return parsed.metaMap["robin:status"]?.[0] ?? parsed.metaMap["robin:state"]?.[0] ?? null;
}

async function assertOwnedArtifact(
  absolutePath: string,
  recordId: string,
  sourceRevision: string,
): Promise<boolean> {
  const html = await fs.readFile(absolutePath, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
  if (!html) return false;
  const parsed = parseRobinHtmlCore(html);
  if (
    parsed.metaMap["robin:generated-by"]?.[0] !== "meeting-compiler" ||
    parsed.metaMap["robin:record-id"]?.[0] !== recordId
  ) {
    throw new Error(`meeting_compiler_path_collision:${absolutePath}`);
  }
  const existingRevision = parsed.metaMap["robin:source-revision"]?.[0];
  if (existingRevision && existingRevision !== sourceRevision) {
    throw new Error(`meeting_compiler_revision_collision:${absolutePath}`);
  }
  return true;
}

async function writeArtifact(input: {
  vault: string;
  artifactPath: string;
  html: string;
  recordId: string;
  sourceRevision: string;
}): Promise<CompiledArtifact> {
  const absolutePath = path.join(/*turbopackIgnore: true*/ input.vault, input.artifactPath);
  // A compiled record is a promoted fact, not a generated cache. Once it
  // exists, later capture replay must never erase a correction or outcome.
  if (await assertOwnedArtifact(absolutePath, input.recordId, input.sourceRevision)) {
    return { path: input.artifactPath, written: false };
  }
  try {
    const result = await writeWithHistory({
      absolutePath,
      html: input.html,
      origin: "web",
      tool: "meeting-compiler",
      vaultRoot: input.vault,
      summary: "Compile reviewed meeting signal",
      expectedHash: null,
    });
    return { path: input.artifactPath, written: result.written };
  } catch (error) {
    // Two ingest workers may race after both observed an absent artifact. The
    // create-only CAS picks one winner; the loser is idempotent only if the
    // winner materialized the exact owned record/revision.
    if (
      error instanceof VaultConflictError &&
      (await assertOwnedArtifact(absolutePath, input.recordId, input.sourceRevision))
    ) {
      return { path: input.artifactPath, written: false };
    }
    throw error;
  }
}

export async function compileMeetingSignals(
  input: CompileMeetingInput,
): Promise<MeetingCompileReceipt> {
  const receipt: MeetingCompileReceipt = {
    decisions: [],
    commitments: [],
    interventions: [],
    receipt: { path: "", written: false },
  };

  for (const decision of input.signals.decisions) {
    const slug = `${input.meetingSlug}-decision-${decision.id}`;
    const artifactPath = path.posix.join("brain", "decisions", `${slug}.html`);
    receipt.decisions.push(
      await writeArtifact({
        vault: input.vault,
        artifactPath,
        html: decisionHtml(input, decision, artifactPath, slug),
        recordId: slug,
        sourceRevision: input.sourceRevision,
      }),
    );
    if (decision.evidenceState === "inferred") {
      const interventionSlug = `${input.meetingSlug}-decision-${decision.id}-confirmation`;
      const interventionPath = path.posix.join(
        "brain",
        "interventions",
        `${interventionSlug}.html`,
      );
      receipt.interventions.push(
        await writeArtifact({
          vault: input.vault,
          artifactPath: interventionPath,
          html: decisionInterventionHtml(
            input,
            decision,
            artifactPath,
            interventionPath,
            interventionSlug,
          ),
          recordId: interventionSlug,
          sourceRevision: input.sourceRevision,
        }),
      );
    }
  }

  for (const commitment of input.signals.commitments) {
    const slug = `${input.meetingSlug}-commitment-${commitment.id}`;
    const artifactPath = path.posix.join("brain", "commitments", `${slug}.html`);
    receipt.commitments.push(
      await writeArtifact({
        vault: input.vault,
        artifactPath,
        html: commitmentHtml(input, commitment, artifactPath, slug),
        recordId: slug,
        sourceRevision: input.sourceRevision,
      }),
    );

    if (commitment.evidenceState === "inferred" || !commitment.owner || !commitment.due) {
      const interventionSlug = `${input.meetingSlug}-commitment-${commitment.id}-confirmation`;
      const interventionPath = path.posix.join(
        "brain",
        "interventions",
        `${interventionSlug}.html`,
      );
      receipt.interventions.push(
        await writeArtifact({
          vault: input.vault,
          artifactPath: interventionPath,
          html: commitmentInterventionHtml(
            input,
            commitment,
            artifactPath,
            interventionPath,
            interventionSlug,
          ),
          recordId: interventionSlug,
          sourceRevision: input.sourceRevision,
        }),
      );
    }
  }

  for (const conflict of input.signals.conflicts) {
    const slug = `${input.meetingSlug}-conflict-${conflict.id}`;
    const artifactPath = path.posix.join("brain", "interventions", `${slug}.html`);
    const status = await currentStatus(
      path.join(/*turbopackIgnore: true*/ input.vault, artifactPath),
    );
    if (status && TERMINAL_INTERVENTION_STATUSES.has(status)) {
      receipt.interventions.push({ path: artifactPath, written: false });
      continue;
    }
    const target = await locateConflictTarget(input.vault, conflict.existingValue);
    receipt.interventions.push(
      await writeArtifact({
        vault: input.vault,
        artifactPath,
        html: conflictInterventionHtml(input, conflict, artifactPath, slug, target),
        recordId: slug,
        sourceRevision: input.sourceRevision,
      }),
    );
  }

  const receiptSlug = `${input.meetingSlug}-compile-receipt`;
  const receiptPath = path.posix.join("logs", "compilations", `${receiptSlug}.html`);
  const allPaths = [
    ...receipt.decisions.map((item) => item.path),
    ...receipt.commitments.map((item) => item.path),
    ...receipt.interventions.map((item) => item.path),
  ].sort((a, b) => a.localeCompare(b));
  const receiptHtml = buildArtifactHtml({
    path: receiptPath,
    slug: receiptSlug,
    type: "compile-receipt",
    status: "completed",
    title: `Compiled ${input.meetingTitle}`,
    summary: `${receipt.decisions.length} decisions, ${receipt.commitments.length} commitments, ${receipt.interventions.length} judgment items.`,
    sourceUpdated: input.sourceUpdated,
    sources: [input.meetingPath, input.sourcePath],
    extraMeta: [
      ["robin:meeting", input.meetingPath],
      ["robin:meeting-id", input.meetingId],
      ["robin:source-revision", input.sourceRevision],
      ["robin:source-updated", input.sourceUpdated],
    ],
    bodyHtml: [
      `<h1 data-block="heading">Compiled ${escapeHtml(input.meetingTitle)}</h1>`,
      `<p data-block="paragraph">${receipt.decisions.length} decisions · ${receipt.commitments.length} commitments · ${receipt.interventions.length} judgment items.</p>`,
      '<ul data-block="bulletList">',
      ...allPaths.map(
        (artifactPath) =>
          `  <li data-block="listItem"><a href="${escapeHtml(vaultPageHref(artifactPath))}">${escapeHtml(artifactPath)}</a></li>`,
      ),
      "</ul>",
      sourceBody(input),
    ].join("\n"),
  });
  receipt.receipt = await writeArtifact({
    vault: input.vault,
    artifactPath: receiptPath,
    html: receiptHtml,
    recordId: receiptSlug,
    sourceRevision: input.sourceRevision,
  });

  return receipt;
}
