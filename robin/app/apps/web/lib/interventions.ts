import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { canonicalizeHtml, parseRobinHtmlCore, type RobinMeta } from "@robin/converter";
import { withVaultLocks, writeWithHistory } from "@robin/vault-io";
import { vaultPageHref } from "./routes";
import { refreshIndexPaths } from "./indexer-client";

export type InterventionResolution =
  | "proposed"
  | "existing"
  | "confirmed"
  | "dismissed"
  | "fulfilled"
  | "missed"
  | "cancelled";

export interface InterventionItem {
  path: string;
  href: string;
  title: string;
  kind:
    | "conflict"
    | "commitment-confirmation"
    | "decision-confirmation"
    | "commitment-checkpoint"
    | "unknown";
  whyNow: string;
  belief: string;
  evidenceState: string;
  recommendedAction: string;
  existingValue?: string;
  proposedValue?: string;
  targetTitle?: string;
  commitmentPath?: string;
  commitmentHref?: string;
  sourceHref?: string;
  updated: string;
}

export interface ResolveInterventionResult {
  path: string;
  status: "resolved" | "dismissed";
  resolution: InterventionResolution;
  alreadyResolved: boolean;
  targetUpdated: boolean;
  targetPath?: string;
  decisionPath?: string;
}

interface ParsedIntervention {
  html: string;
  title: string;
  get: (name: string) => string | undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value)
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\t", "&#9;");
}

function upsertMeta(html: string, name: string, value: string): string {
  const tag = `  <meta name="${escapeAttr(name)}" content="${escapeAttr(value)}">`;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^[ \\t]*<meta\\s+name=["']${escapedName}["'][^>]*>\\s*$`, "mi");
  if (pattern.test(html)) return html.replace(pattern, tag);
  return html.replace(/<\/head>/i, `${tag}\n</head>`);
}

function safeInterventionPath(relPath: string): boolean {
  const normalized = path.posix.normalize(relPath.replaceAll(path.sep, "/"));
  return (
    normalized === relPath.replaceAll(path.sep, "/") &&
    normalized.startsWith("brain/interventions/") &&
    normalized.endsWith(".html") &&
    !normalized.includes("../")
  );
}

function safeBrainTarget(relPath: string): boolean {
  const normalized = path.posix.normalize(relPath.replaceAll(path.sep, "/"));
  return (
    normalized === relPath.replaceAll(path.sep, "/") &&
    normalized.startsWith("brain/") &&
    normalized.endsWith(".html") &&
    !normalized.startsWith("brain/interventions/") &&
    !normalized.includes("../")
  );
}

function parseIntervention(html: string): ParsedIntervention {
  const parsed = parseRobinHtmlCore(html);
  return {
    html,
    title: parsed.title,
    get: (name: string) => parsed.metaMap[name]?.[0],
  };
}

async function readIntervention(vault: string, relPath: string): Promise<ParsedIntervention> {
  if (!safeInterventionPath(relPath)) throw new Error("invalid_intervention_path");
  const html = await fs.readFile(path.join(/*turbopackIgnore: true*/ vault, relPath), "utf8");
  const parsed = parseIntervention(html);
  if (parsed.get("robin:type") !== "intervention") throw new Error("not_an_intervention");
  return parsed;
}

export async function listOpenInterventions(vault: string): Promise<InterventionItem[]> {
  const dir = path.join(/*turbopackIgnore: true*/ vault, "brain", "interventions");
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const items: InterventionItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".html") || entry.name.startsWith(".")) continue;
    const relPath = path.posix.join("brain", "interventions", entry.name);
    const html = await fs
      .readFile(path.join(/*turbopackIgnore: true*/ dir, entry.name), "utf8")
      .catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw error;
      });
    if (!html) continue;
    const parsed = parseIntervention(html);
    if (parsed.get("robin:type") !== "intervention") continue;
    const status = parsed.get("robin:status") ?? parsed.get("robin:state") ?? "open";
    if (status !== "open") continue;
    const kindRaw = parsed.get("robin:kind");
    const kind =
      kindRaw === "conflict" ||
      kindRaw === "commitment-confirmation" ||
      kindRaw === "decision-confirmation" ||
      kindRaw === "commitment-checkpoint"
        ? kindRaw
        : "unknown";
    const meetingPath = parsed.get("robin:meeting");
    const commitmentPath = parsed.get("robin:commitment");
    items.push({
      path: relPath,
      href: vaultPageHref(relPath),
      title: parsed.title || parsed.get("robin:question") || entry.name.replace(/\.html$/, ""),
      kind,
      whyNow: parsed.get("robin:why-now") ?? parsed.get("robin:summary") ?? "",
      belief: parsed.get("robin:belief") ?? "",
      evidenceState: parsed.get("robin:evidence-state") ?? "tentative",
      recommendedAction: parsed.get("robin:recommended-action") ?? "Review",
      existingValue: parsed.get("robin:existing-value"),
      proposedValue: parsed.get("robin:proposed-value"),
      targetTitle: parsed.get("robin:target-title"),
      commitmentPath,
      commitmentHref: commitmentPath ? vaultPageHref(commitmentPath) : undefined,
      sourceHref: meetingPath ? vaultPageHref(meetingPath) : undefined,
      updated: parsed.get("robin:updated") ?? "",
    });
  }

  const kindRank = (item: InterventionItem) =>
    item.kind === "conflict"
      ? 0
      : item.kind === "commitment-checkpoint"
        ? 1
        : item.kind === "decision-confirmation"
          ? 2
          : item.kind === "commitment-confirmation"
            ? 3
            : 4;
  return items.sort((a, b) => {
    const rank = kindRank(a) - kindRank(b);
    return rank || b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title);
  });
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

async function applyProposedValue(input: {
  vault: string;
  targetPath: string;
  targetMatch: string;
  targetHash: string;
  proposedValue: string;
  resolvedAt: string;
}): Promise<boolean> {
  if (!safeBrainTarget(input.targetPath)) throw new Error("unsafe_intervention_target");
  const absolutePath = path.join(/*turbopackIgnore: true*/ input.vault, input.targetPath);
  const current = await fs.readFile(absolutePath, "utf8");
  const occurrences = countOccurrences(current, input.targetMatch);
  if (occurrences === 0 && current.includes(escapeHtml(input.proposedValue))) return false;
  const currentHash = crypto.createHash("sha256").update(current, "utf8").digest("hex");
  if (currentHash !== input.targetHash) throw new Error("intervention_target_changed");
  if (occurrences !== 1) throw new Error("target_value_is_not_unique");
  let next = current.replace(input.targetMatch, escapeHtml(input.proposedValue));
  next = upsertMeta(next, "robin:updated", input.resolvedAt);
  const write = await writeWithHistory({
    absolutePath,
    html: next,
    origin: "web",
    tool: "resolve-intervention",
    vaultRoot: input.vault,
    summary: `Apply approved value ${input.proposedValue}`,
    expectedHash: currentHash,
  });
  return write.written;
}

function upsertOutcomeBlock(html: string, outcome: string, resolvedAt: string): string {
  const block = `<p data-block="paragraph" data-robin-outcome><strong>Outcome:</strong> ${escapeHtml(outcome)} <small>(${escapeHtml(resolvedAt.slice(0, 10))})</small>.</p>`;
  if (/<p\b[^>]*data-robin-outcome[^>]*>[\s\S]*?<\/p>/i.test(html)) {
    return html.replace(/<p\b[^>]*data-robin-outcome[^>]*>[\s\S]*?<\/p>/i, block);
  }
  return html.replace(/<\/article>/i, `${block}\n</article>`);
}

async function updateCommitmentReview(input: {
  vault: string;
  commitmentPath: string;
  confirmed: boolean;
  resolvedAt: string;
}): Promise<boolean> {
  if (
    !safeBrainTarget(input.commitmentPath) ||
    !input.commitmentPath.startsWith("brain/commitments/")
  ) {
    throw new Error("invalid_commitment_target");
  }
  const absolutePath = path.join(/*turbopackIgnore: true*/ input.vault, input.commitmentPath);
  let html = await fs.readFile(absolutePath, "utf8");
  const expectedHash = crypto.createHash("sha256").update(html, "utf8").digest("hex");
  if (input.confirmed) {
    html = upsertMeta(html, "robin:status", "active");
    html = upsertMeta(html, "robin:lifecycle", "active");
    html = upsertMeta(html, "robin:review-state", "confirmed");
    html = upsertMeta(html, "robin:evidence-state", "confirmed");
  } else {
    html = upsertMeta(html, "robin:status", "dismissed");
    html = upsertMeta(html, "robin:lifecycle", "dismissed");
    html = upsertMeta(html, "robin:review-state", "tentative");
  }
  html = upsertMeta(html, "robin:updated", input.resolvedAt);
  const write = await writeWithHistory({
    absolutePath,
    html,
    origin: "web",
    tool: "resolve-intervention",
    vaultRoot: input.vault,
    summary: input.confirmed
      ? "Confirm meeting commitment"
      : "Dismiss tentative meeting commitment",
    expectedHash,
  });
  return write.written;
}

async function applyCommitmentOutcome(input: {
  vault: string;
  commitmentPath: string;
  targetHash: string;
  resolution: "fulfilled" | "missed" | "cancelled";
  interventionPath: string;
  resolvedAt: string;
}): Promise<boolean> {
  if (
    !safeBrainTarget(input.commitmentPath) ||
    !input.commitmentPath.startsWith("brain/commitments/")
  ) {
    throw new Error("invalid_commitment_target");
  }
  const absolutePath = path.join(/*turbopackIgnore: true*/ input.vault, input.commitmentPath);
  let html = await fs.readFile(absolutePath, "utf8");
  const currentHash = crypto.createHash("sha256").update(html, "utf8").digest("hex");
  if (currentHash !== input.targetHash) throw new Error("intervention_target_changed");
  const parsed = parseRobinHtmlCore(html);
  const currentLifecycle =
    parsed.metaMap["robin:lifecycle"]?.[0] ?? parsed.metaMap["robin:status"]?.[0] ?? "active";
  if (!["active", "open", "confirmed", "tentative"].includes(currentLifecycle)) {
    return false;
  }
  const labels = {
    fulfilled: "Kept as promised",
    missed: "Missed",
    cancelled: "Released from the promise",
  } as const;
  const health =
    input.resolution === "fulfilled"
      ? "on-track"
      : input.resolution === "missed"
        ? "at-risk"
        : "unknown";
  html = upsertMeta(html, "robin:status", input.resolution);
  html = upsertMeta(html, "robin:lifecycle", input.resolution);
  html = upsertMeta(html, "robin:health", health);
  html = upsertMeta(html, "robin:outcome-at", input.resolvedAt);
  html = upsertMeta(html, "robin:outcome-source", input.interventionPath);
  html = upsertMeta(html, "robin:updated", input.resolvedAt);
  html = upsertOutcomeBlock(html, labels[input.resolution], input.resolvedAt);
  const write = await writeWithHistory({
    absolutePath,
    html,
    origin: "web",
    tool: "resolve-intervention",
    vaultRoot: input.vault,
    summary: `Record commitment outcome: ${input.resolution}`,
    expectedHash: currentHash,
  });
  return write.written;
}

function resolutionDecisionHtml(input: {
  interventionPath: string;
  interventionSlug: string;
  decisionPath: string;
  decisionSlug: string;
  title: string;
  subject: string;
  selectedValue: string;
  resolvedAt: string;
  meetingPath?: string;
}): string {
  const meta: RobinMeta = {
    version: "0.2",
    path: input.decisionPath,
    slug: input.decisionSlug,
    type: "decision",
    status: "confirmed",
    updated: input.resolvedAt,
    summary: `${input.subject}: ${input.selectedValue}.`,
    sources: [input.interventionPath, ...(input.meetingPath ? [input.meetingPath] : [])],
    tags: ["intervention-resolution"],
    attendees: [],
    unknownKeys: [],
  };
  return canonicalizeHtml({
    meta,
    frontmatter: { title: input.title },
    blocks: [],
    updatedAt: new Date(input.resolvedAt),
    extraMeta: [
      ["robin:generated-by", "intervention-resolution"],
      ["robin:subject", input.subject],
      ["robin:selected-value", input.selectedValue],
      ["robin:intervention", input.interventionPath],
    ],
    bodyHtml: [
      `<h1 data-block="heading">${escapeHtml(input.title)}</h1>`,
      `<p data-block="paragraph"><strong>Confirmed:</strong> ${escapeHtml(input.subject)} is ${escapeHtml(input.selectedValue)}.</p>`,
      `<p data-block="paragraph">Resolved from <a href="${escapeHtml(vaultPageHref(input.interventionPath))}">this judgment item</a>.</p>`,
    ].join("\n"),
  });
}

export async function resolveIntervention(
  vault: string,
  relPath: string,
  resolution: InterventionResolution,
): Promise<ResolveInterventionResult> {
  // Discover the complete affected path set, acquire it in canonical order,
  // then re-read under lock. Nested writeWithHistory calls reuse these locks,
  // so two resolution workflows cannot each commit different side effects
  // before racing on the final intervention update.
  const preview = await readIntervention(vault, relPath);
  const lockedPaths = interventionPaths(preview, relPath, resolution);
  return withVaultLocks(
    vault,
    lockedPaths.map((item) => `page:${item}`),
    async () => {
      const parsed = await readIntervention(vault, relPath);
      const requiredPaths = interventionPaths(parsed, relPath, resolution);
      if (requiredPaths.some((item) => !lockedPaths.includes(item))) {
        throw new Error("intervention_changed_retry");
      }
      return resolveInterventionLocked(vault, relPath, resolution, parsed);
    },
  );
}

function interventionPaths(
  parsed: ParsedIntervention,
  relPath: string,
  resolution: InterventionResolution,
): string[] {
  const related = [
    relPath,
    parsed.get("robin:target"),
    parsed.get("robin:commitment"),
    parsed.get("robin:decision"),
  ].filter((item): item is string => Boolean(item));
  if (
    parsed.get("robin:kind") === "conflict" &&
    (resolution === "proposed" || resolution === "existing")
  ) {
    const slug = `${path.basename(relPath, ".html")}-resolution`;
    related.push(path.posix.join("brain", "decisions", `${slug}.html`));
  }
  return [...new Set(related.filter((item) => item === relPath || safeBrainTarget(item)))].sort();
}

async function resolveInterventionLocked(
  vault: string,
  relPath: string,
  resolution: InterventionResolution,
  parsed: ParsedIntervention,
): Promise<ResolveInterventionResult> {
  const currentStatus = parsed.get("robin:status") ?? parsed.get("robin:state") ?? "open";
  if (currentStatus === "resolved" || currentStatus === "dismissed") {
    return {
      path: relPath,
      status: currentStatus,
      resolution:
        (parsed.get("robin:resolution") as InterventionResolution | undefined) ?? resolution,
      alreadyResolved: true,
      targetUpdated: false,
      targetPath: parsed.get("robin:target"),
    };
  }
  if (currentStatus !== "open") throw new Error("intervention_not_open");

  const kind = parsed.get("robin:kind");
  const allowed =
    kind === "conflict"
      ? new Set<InterventionResolution>(["proposed", "existing", "dismissed"])
      : kind === "commitment-checkpoint"
        ? new Set<InterventionResolution>(["fulfilled", "missed", "cancelled"])
        : kind === "commitment-confirmation" || kind === "decision-confirmation"
          ? new Set<InterventionResolution>(["confirmed", "dismissed"])
          : new Set<InterventionResolution>(["dismissed"]);
  if (!allowed.has(resolution)) throw new Error("invalid_resolution");

  const resolvedAt = new Date().toISOString();
  const targetPath = parsed.get("robin:target") ?? parsed.get("robin:commitment");
  let targetUpdated = false;
  let decisionPath: string | undefined;
  const changedPaths = new Set<string>();

  if (kind === "conflict" && resolution === "proposed") {
    const targetMatch = parsed.get("robin:target-match");
    const targetHash = parsed.get("robin:target-hash");
    const proposedValue = parsed.get("robin:proposed-value");
    if (targetPath && targetMatch && targetHash && proposedValue) {
      targetUpdated = await applyProposedValue({
        vault,
        targetPath,
        targetMatch,
        targetHash,
        proposedValue,
        resolvedAt,
      });
      if (targetUpdated) changedPaths.add(targetPath);
    }
  }

  if (
    kind === "commitment-confirmation" &&
    (resolution === "confirmed" || resolution === "dismissed")
  ) {
    const commitmentPath = parsed.get("robin:commitment");
    if (!commitmentPath) throw new Error("invalid_commitment_target");
    targetUpdated = await updateCommitmentReview({
      vault,
      commitmentPath,
      confirmed: resolution === "confirmed",
      resolvedAt,
    });
    if (targetUpdated) changedPaths.add(commitmentPath);
  }

  if (
    kind === "commitment-checkpoint" &&
    (resolution === "fulfilled" || resolution === "missed" || resolution === "cancelled")
  ) {
    const commitmentPath = parsed.get("robin:commitment");
    const targetHash = parsed.get("robin:target-hash");
    if (!commitmentPath || !targetHash) throw new Error("invalid_commitment_target");
    targetUpdated = await applyCommitmentOutcome({
      vault,
      commitmentPath,
      targetHash,
      resolution,
      interventionPath: relPath,
      resolvedAt,
    });
    if (targetUpdated) changedPaths.add(commitmentPath);
  }

  if (kind === "decision-confirmation" && resolution === "confirmed") {
    decisionPath = parsed.get("robin:decision");
    if (
      !decisionPath ||
      !safeBrainTarget(decisionPath) ||
      !decisionPath.startsWith("brain/decisions/")
    ) {
      throw new Error("invalid_decision_target");
    }
    const absolutePath = path.join(/*turbopackIgnore: true*/ vault, decisionPath);
    let decisionHtml = await fs.readFile(absolutePath, "utf8");
    const expectedHash = crypto.createHash("sha256").update(decisionHtml, "utf8").digest("hex");
    decisionHtml = upsertMeta(decisionHtml, "robin:status", "confirmed");
    decisionHtml = upsertMeta(decisionHtml, "robin:evidence-state", "confirmed");
    decisionHtml = upsertMeta(decisionHtml, "robin:updated", resolvedAt);
    const write = await writeWithHistory({
      absolutePath,
      html: decisionHtml,
      origin: "web",
      tool: "resolve-intervention",
      vaultRoot: vault,
      summary: "Confirm inferred meeting decision",
      expectedHash,
    });
    targetUpdated = write.written;
    if (write.written) changedPaths.add(decisionPath);
  }

  if (kind === "conflict" && (resolution === "proposed" || resolution === "existing")) {
    const selectedValue =
      resolution === "proposed"
        ? parsed.get("robin:proposed-value")
        : parsed.get("robin:existing-value");
    const subject = parsed.get("robin:subject") ?? "Selected value";
    if (!selectedValue) throw new Error("missing_resolution_value");
    const interventionSlug = path.basename(relPath, ".html");
    const decisionSlug = `${interventionSlug}-resolution`;
    decisionPath = path.posix.join("brain", "decisions", `${decisionSlug}.html`);
    const html = resolutionDecisionHtml({
      interventionPath: relPath,
      interventionSlug,
      decisionPath,
      decisionSlug,
      title: `Confirmed ${subject}`,
      subject,
      selectedValue,
      resolvedAt,
      meetingPath: parsed.get("robin:meeting"),
    });
    const decisionAbsolutePath = path.join(/*turbopackIgnore: true*/ vault, decisionPath);
    const existingDecision = await fs.readFile(decisionAbsolutePath, "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (existingDecision !== null) {
      const existing = parseRobinHtmlCore(existingDecision).metaMap;
      if (
        existing["robin:generated-by"]?.[0] !== "intervention-resolution" ||
        existing["robin:intervention"]?.[0] !== relPath ||
        existing["robin:subject"]?.[0] !== subject ||
        existing["robin:selected-value"]?.[0] !== selectedValue
      ) {
        throw new Error("intervention_decision_path_collision");
      }
      // A prior interrupted attempt already committed the durable decision.
      // Reuse it and continue to close the still-open intervention.
    } else {
      const write = await writeWithHistory({
        absolutePath: decisionAbsolutePath,
        html,
        origin: "web",
        tool: "resolve-intervention",
        vaultRoot: vault,
        summary: `Record judgment: ${subject} is ${selectedValue}`,
        expectedHash: null,
      });
      if (write.written) changedPaths.add(decisionPath);
    }
  }

  const finalStatus = resolution === "dismissed" ? "dismissed" : "resolved";
  let resolvedHtml = upsertMeta(parsed.html, "robin:status", finalStatus);
  resolvedHtml = upsertMeta(resolvedHtml, "robin:resolution", resolution);
  resolvedHtml = upsertMeta(resolvedHtml, "robin:resolved-at", resolvedAt);
  resolvedHtml = upsertMeta(resolvedHtml, "robin:updated", resolvedAt);
  const interventionWrite = await writeWithHistory({
    absolutePath: path.join(/*turbopackIgnore: true*/ vault, relPath),
    html: resolvedHtml,
    origin: "web",
    tool: "resolve-intervention",
    vaultRoot: vault,
    summary: `Resolve judgment item: ${resolution}`,
    expectedHash: crypto.createHash("sha256").update(parsed.html, "utf8").digest("hex"),
  });
  if (interventionWrite.written) changedPaths.add(relPath);
  if (changedPaths.size > 0) {
    await refreshIndexPaths([...changedPaths]).catch((error) => {
      console.warn("[interventions] writes committed but index refresh failed:", error);
    });
  }

  return {
    path: relPath,
    status: finalStatus,
    resolution,
    alreadyResolved: false,
    targetUpdated,
    targetPath,
    decisionPath,
  };
}
