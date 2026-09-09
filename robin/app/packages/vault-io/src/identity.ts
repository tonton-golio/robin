/**
 * Immutable Robin page identity checks at the lowest shared write boundary.
 *
 * UI/MCP producers validate metadata too, but direct callers of vault-io must
 * not be able to downgrade a v0.3 page or replace its UUID. Structural parsing
 * avoids treating commented-out tags as real metadata.
 */

import { ROBIN_SOURCE_KINDS, readHeadRobinMetaMap } from "@robin/converter";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Identity {
  version?: string;
  id?: string;
}

function validateWrittenPage(html: string): Identity {
  const meta = readHeadRobinMetaMap(html);
  const versions = meta["robin:version"] ?? [];
  if (versions.length === 0) return {};
  if (versions.length !== 1) throw new Error("robin_metadata_invalid: duplicate robin:version");
  const version = versions[0];
  if (!version) throw new Error("robin_metadata_invalid: empty robin:version");
  if (version !== "0.2" && version !== "0.3") {
    throw new Error(`robin_metadata_invalid: unsupported robin:version ${version}`);
  }

  const ids = meta["robin:id"] ?? [];
  const kinds = meta["robin:source-kind"] ?? [];
  const refs = meta["robin:source-ref"] ?? [];
  if (version === "0.2") {
    if (ids.length > 0 || kinds.length > 0 || refs.length > 0) {
      throw new Error("robin_metadata_invalid: v0.3 identity/provenance requires version 0.3");
    }
    return { version };
  }

  const id = ids[0];
  if (ids.length !== 1 || !id || !UUID_RE.test(id)) {
    throw new Error("robin_metadata_invalid: v0.3 requires one lowercase robin:id UUID");
  }
  if ((meta["robin:source"] ?? []).length > 0) {
    throw new Error("robin_metadata_invalid: v0.3 cannot contain legacy robin:source");
  }
  if (kinds.length !== refs.length) {
    throw new Error("robin_metadata_invalid: typed provenance cardinality mismatch");
  }
  if (
    kinds.some((kind) => !ROBIN_SOURCE_KINDS.has(kind as never)) ||
    refs.some((ref) => !ref.trim()) ||
    new Set(refs).size !== refs.length
  ) {
    throw new Error("robin_metadata_invalid: invalid typed provenance");
  }
  return { version, id };
}

export function assertPageIdentityTransition(priorHtml: string | null, nextHtml: string): void {
  const next = validateWrittenPage(nextHtml);
  if (priorHtml === null) return;

  const priorMeta = readHeadRobinMetaMap(priorHtml);
  const priorVersions = priorMeta["robin:version"] ?? [];
  if (priorVersions.length > 1) {
    throw new Error("robin_metadata_invalid: duplicate prior robin:version");
  }
  const priorVersion = priorVersions[0];
  if (priorVersion && !["0.1", "0.2", "0.3"].includes(priorVersion)) {
    throw new Error(
      `robin_identity_conflict: cannot rewrite unsupported prior robin:version ${priorVersion}`,
    );
  }
  if (priorVersion !== "0.3") return;

  const prior = validateWrittenPage(priorHtml);
  if (next.version !== "0.3") {
    throw new Error("robin_identity_conflict: v0.3 pages cannot be downgraded");
  }
  if (next.id !== prior.id) {
    throw new Error(
      `robin_identity_conflict: immutable robin:id changed from ${prior.id} to ${next.id}`,
    );
  }
}
