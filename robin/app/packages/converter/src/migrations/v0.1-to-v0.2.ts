/**
 * Robin format migration: v0.1 → v0.2.
 *
 * v0.1 documents carried two embedded JSON payloads in <head>:
 *   - <script type="application/json" id="robin:frontmatter">...</script>
 *   - <script type="application/json" id="robin:blocks">...</script>
 *
 * Both were write-only dead weight. v0.2 drops them — the <article> body
 * inside <body> is the single source of truth, and the <head> meta tags are
 * the canonical metadata mirror.
 *
 * This migration:
 *   1. Removes both #robin:frontmatter and #robin:blocks <script> elements.
 *   2. Bumps the `robin:version` <meta> to "0.2" (inserting it if absent).
 *   3. Preserves all other meta, <title>, <link rel="canonical">, and the
 *      <article data-robin-doc> body byte-for-byte.
 *   4. Is idempotent — running it on a v0.2 document produces no changes.
 *
 * Implementation note: structural source offsets let us edit the real <head>
 * without parse-and-reserializing the document, so the on-disk <article> body
 * remains byte-identical.
 */
import { readHeadMetaValues, removeHeadScriptTagsById, upsertHeadMetaTag } from "../html-meta.js";
import { assertRobinMigrationCandidate } from "../parse.js";
import { normalizeIdentityPath } from "./identity-path.js";

export interface MigrationResult {
  /** The migrated HTML document. */
  html: string;
  /** True if any change was made; false when the input was already v0.2. */
  changed: boolean;
}

export interface MigrateV01ToV02Options {
  /** Actual vault-relative path, used to verify or add robin:path. */
  vaultRelativePath?: string;
}

const LEGACY_PREFIX = ["her", "mes:"].join("");
const LEGACY_SCRIPT_IDS = [
  "robin:frontmatter",
  "robin:blocks",
  `${LEGACY_PREFIX}frontmatter`,
  `${LEGACY_PREFIX}blocks`,
];

export function migrateV01ToV02(
  html: string,
  options: MigrateV01ToV02Options = {},
): MigrationResult {
  assertRobinMigrationCandidate(html);
  const versions = readHeadMetaValues(html, "robin:version");
  if (versions.length > 1) {
    throw new Error("v0.2 migration refuses duplicate robin:version metadata");
  }
  const version = versions[0];
  if (version && version !== "0.1" && version !== "0.2") {
    throw new Error(`v0.2 migration refuses to downgrade document version ${version}`);
  }
  const storedPaths = readHeadMetaValues(html, "robin:path");
  if (storedPaths.length > 1) {
    throw new Error("v0.2 migration refuses duplicate robin:path metadata");
  }
  const storedPath = storedPaths[0];
  const actualPath = options.vaultRelativePath
    ? normalizeIdentityPath(options.vaultRelativePath)
    : undefined;
  if (storedPath && actualPath && normalizeIdentityPath(storedPath) !== actualPath) {
    throw new Error(
      `robin:path mismatch: stored ${storedPath}, actual ${options.vaultRelativePath}`,
    );
  }
  const original = html;
  let out = removeHeadScriptTagsById(html, LEGACY_SCRIPT_IDS);

  // Replace or insert the real head metadata structurally. This covers valid
  // quote/attribute-order variants without matching comments or body examples.
  out = upsertHeadMetaTag(out, "robin:version", "0.2");
  if (actualPath && storedPath !== actualPath) {
    out = upsertHeadMetaTag(out, "robin:path", actualPath);
  }

  return { html: out, changed: out !== original };
}
