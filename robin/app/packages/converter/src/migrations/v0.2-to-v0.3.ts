/**
 * Robin format migration: v0.2 → v0.3.
 *
 * v0.3 adds an immutable UUID (`robin:id`) and replaces overloaded
 * `robin:source` values with ordered `robin:source-kind` / `robin:source-ref`
 * pairs. The default writer remains on v0.2 until the operator runs this
 * migration deliberately; no live vault data is rewritten implicitly.
 */

import crypto from "node:crypto";
import {
  appendHeadMetaTags,
  readHeadRobinMetaMap,
  removeHeadMetaTags,
  upsertHeadMetaTag,
} from "../html-meta.js";
import { assertRobinMigrationCandidate } from "../parse.js";
import type { RobinSourceKind } from "../types.js";
import { normalizeIdentityPath } from "./identity-path.js";
import type { MigrationResult } from "./v0.1-to-v0.2.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface MigrateV02ToV03Options {
  /**
   * Actual pre-migration vault-relative path. The migration verifies it against
   * robin:path (or inserts it when a legacy page lacks that tag).
   */
  vaultRelativePath?: string;
}

interface TypedSource {
  kind: RobinSourceKind;
  ref: string;
}

export function migrateV02ToV03(
  html: string,
  options: MigrateV02ToV03Options = {},
): MigrationResult {
  assertRobinMigrationCandidate(html);
  const metaMap = readHeadRobinMetaMap(html);
  const versions = metaMap["robin:version"] ?? [];
  if (versions.length > 1) {
    throw new Error("v0.3 migration refuses duplicate robin:version metadata");
  }
  const version = versions[0] ?? "0.1";
  if (version === "0.3") {
    validateV03(metaMap, options.vaultRelativePath);
    const id = metaMap["robin:id"]?.[0];
    if (!id) throw new Error("v0.3 document is missing robin:id");
    const canonical =
      id === id.toLowerCase() ? html : upsertHeadMetaTag(html, "robin:id", id.toLowerCase());
    return { html: canonical, changed: canonical !== html };
  }
  if (version !== "0.2") {
    throw new Error(`v0.3 migration requires a v0.2 document; found ${version}`);
  }

  const storedPaths = metaMap["robin:path"] ?? [];
  if (storedPaths.length > 1) {
    throw new Error("v0.3 migration refuses duplicate robin:path metadata");
  }
  const storedPath = storedPaths[0];
  const normalizedStoredPath = storedPath ? normalizeIdentityPath(storedPath) : undefined;
  const actualPath = options.vaultRelativePath
    ? normalizeIdentityPath(options.vaultRelativePath)
    : undefined;
  if (normalizedStoredPath && actualPath && normalizedStoredPath !== actualPath) {
    throw new Error(
      `robin:path mismatch: stored ${storedPath}, actual ${options.vaultRelativePath}`,
    );
  }
  const canonicalPath = actualPath ?? normalizedStoredPath;
  if (!canonicalPath) {
    throw new Error("v0.3 migration requires robin:path or vaultRelativePath");
  }

  const existingIds = metaMap["robin:id"] ?? [];
  if (existingIds.length > 1) {
    throw new Error("v0.3 migration refuses duplicate robin:id metadata");
  }
  if (existingIds.length > 0) {
    throw new Error("v0.2 document cannot contain a pre-seeded robin:id");
  }
  // Generate the identity once and persist it in the same durable replacement
  // as the version bump. A random UUID avoids collisions when two independent
  // vaults happen to contain the same relative path.
  const id = crypto.randomUUID().toLowerCase();

  const existingKinds = metaMap["robin:source-kind"] ?? [];
  const existingRefs = metaMap["robin:source-ref"] ?? [];
  if (existingKinds.length > 0 || existingRefs.length > 0) {
    throw new Error("v0.2 document cannot contain pre-seeded typed provenance");
  }

  const sources: TypedSource[] = [];
  for (const legacy of metaMap["robin:source"] ?? []) {
    sources.push(typedLegacySource(legacy));
  }
  const canonicalSources = dedupeAndSortSources(sources);

  let out = removeHeadMetaTags(html, [
    "robin:id",
    "robin:source",
    "robin:source-kind",
    "robin:source-ref",
  ]);
  out = upsertHeadMetaTag(out, "robin:version", "0.3");
  if (storedPath !== canonicalPath) out = upsertHeadMetaTag(out, "robin:path", canonicalPath);
  out = appendHeadMetaTags(out, [
    ["robin:id", id],
    ...canonicalSources.flatMap(({ kind, ref }) => [
      ["robin:source-kind", kind] as const,
      ["robin:source-ref", ref] as const,
    ]),
  ]);
  validateV03(readHeadRobinMetaMap(out), actualPath);

  return { html: out, changed: out !== html };
}

function validateV03(metaMap: Record<string, string[]>, vaultRelativePath?: string): void {
  const versions = metaMap["robin:version"] ?? [];
  const ids = metaMap["robin:id"] ?? [];
  const paths = metaMap["robin:path"] ?? [];
  if (versions.length !== 1 || versions[0] !== "0.3") {
    throw new Error("v0.3 document must contain exactly one robin:version=0.3");
  }
  const id = ids[0];
  if (ids.length !== 1 || !id || !UUID_RE.test(id)) {
    throw new Error("v0.3 document must contain exactly one valid robin:id UUID");
  }
  if (paths.length !== 1) {
    throw new Error("v0.3 document must contain exactly one robin:path");
  }
  if ((metaMap["robin:source"] ?? []).length > 0) {
    throw new Error("v0.3 document cannot contain legacy robin:source tags");
  }
  const kinds = metaMap["robin:source-kind"] ?? [];
  const refs = metaMap["robin:source-ref"] ?? [];
  if (kinds.length !== refs.length) {
    throw new Error(
      `robin:source-kind/source-ref cardinality mismatch: ${kinds.length} != ${refs.length}`,
    );
  }
  for (const kind of kinds) assertSourceKind(kind);
  if (refs.some((ref) => !ref.trim()) || new Set(refs).size !== refs.length) {
    throw new Error("v0.3 source refs must be non-empty and unique");
  }
  if (vaultRelativePath) {
    const storedPath = paths[0];
    if (
      !storedPath ||
      normalizeIdentityPath(storedPath) !== normalizeIdentityPath(vaultRelativePath)
    ) {
      throw new Error(
        `robin:path mismatch: stored ${storedPath ?? "<missing>"}, actual ${vaultRelativePath}`,
      );
    }
  }
}

function typedLegacySource(value: string): TypedSource {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Empty robin:source cannot be migrated");
  const kind = inferSourceKind(trimmed);
  return {
    kind,
    ref: looksLikeReference(trimmed)
      ? trimmed
      : `urn:robin:legacy-source:${encodeURIComponent(trimmed)}`,
  };
}

export function inferSourceKind(value: string): RobinSourceKind {
  const lower = value.toLowerCase();
  if (lower === "slack" || lower.startsWith("slack:") || lower.includes("slack.com/")) {
    return "slack";
  }
  if (lower.startsWith("mailto:") || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lower)) return "email";
  if (/^https?:\/\//.test(lower)) return "web";
  if (/\bannotation\b/.test(lower)) return "annotation";
  if (/\bmeeting\b/.test(lower) || /(^|\/)meetings?\//.test(lower)) return "meeting";
  if (/\bconversation\b|\bchat\b/.test(lower)) return "conversation";
  if (/\bmanual\b|\bhuman\b/.test(lower)) return "manual";
  if (/\b(?:import|ingest|ingested|ingestion)\b/.test(lower)) return "import";
  if (/\bupload\b/.test(lower)) return "upload";
  if (/\.(mp3|m4a|wav|aac|flac|ogg)(?:[?#].*)?$/.test(lower)) return "audio";
  if (
    lower.includes("/") ||
    /\.(md|html?|pdf|docx?|xlsx?|csv|tsv|txt|json|jsonl)(?:[?#].*)?$/.test(lower)
  ) {
    return "document";
  }
  return "other";
}

function looksLikeReference(value: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.includes("/") ||
    value.includes("\\") ||
    /\.[a-z0-9]{1,8}(?:[?#].*)?$/i.test(value)
  );
}

function dedupeAndSortSources(sources: TypedSource[]): TypedSource[] {
  const byRef = new Map<string, TypedSource>();
  for (const source of sources) {
    const prior = byRef.get(source.ref);
    if (prior && prior.kind !== source.kind) {
      throw new Error(
        `Conflicting source kinds for ${source.ref}: ${prior.kind} and ${source.kind}`,
      );
    }
    byRef.set(source.ref, source);
  }
  return [...byRef.values()].sort((a, b) =>
    a.ref !== b.ref ? a.ref.localeCompare(b.ref) : a.kind.localeCompare(b.kind),
  );
}

function assertSourceKind(value: string): RobinSourceKind {
  const allowed = new Set<RobinSourceKind>([
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
  if (!allowed.has(value as RobinSourceKind)) {
    throw new Error(`Invalid robin:source-kind: ${value}`);
  }
  return value as RobinSourceKind;
}
