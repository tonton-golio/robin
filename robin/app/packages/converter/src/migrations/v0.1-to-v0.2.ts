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
 *      <article data-robin-doc> body byte-for-byte (modulo top-level
 *      whitespace normalization in the <head>).
 *   4. Is idempotent — running it on a v0.2 document produces no changes.
 *
 * Implementation note: we do this with string surgery rather than a full
 * HTML parse-and-reserialize because the goal is to preserve the on-disk
 * <article> body verbatim, including any hand-authored whitespace.
 */

export interface MigrationResult {
  /** The migrated HTML document. */
  html: string;
  /** True if any change was made; false when the input was already v0.2. */
  changed: boolean;
}

const SCRIPT_RE =
  /[ \t]*<script\b[^>]*\bid\s*=\s*"robin:(?:frontmatter|blocks)"[^>]*>[\s\S]*?<\/script>\r?\n?/g;
const VERSION_META_RE = /<meta\s+name\s*=\s*"robin:version"\s+content\s*=\s*"([^"]*)"\s*>/i;

export function migrateV01ToV02(html: string): MigrationResult {
  const original = html;
  let out = html;

  // 1. Strip the two embedded JSON payloads.
  out = out.replace(SCRIPT_RE, '');

  // 2. Bump (or insert) robin:version.
  const versionMatch = out.match(VERSION_META_RE);
  if (versionMatch) {
    if (versionMatch[1] !== '0.2') {
      out = out.replace(VERSION_META_RE, '<meta name="robin:version" content="0.2">');
    }
  } else {
    // Insert robin:version meta as the first robin:* meta tag (canonical sort
    // puts it first by name; placement near other meta keeps diffs sane).
    out = insertVersionMeta(out);
  }

  // 3. Collapse any blank-line run left in <head> by script removal so we don't
  //    bloat the diff. Only touches whitespace between </title>/<link>/<meta>
  //    inside <head>, never the <body> or <article>.
  out = collapseHeadBlankLines(out);

  return { html: out, changed: out !== original };
}

function insertVersionMeta(html: string): string {
  // Place immediately after <link rel="canonical" ...> if present, else after
  // <title>...</title>, else just before </head>.
  const insertion = `  <meta name="robin:version" content="0.2">\n`;
  const canonicalIdx = html.search(/<link\s+rel\s*=\s*"canonical"[^>]*>\s*\n/i);
  if (canonicalIdx >= 0) {
    const match = html.match(/<link\s+rel\s*=\s*"canonical"[^>]*>\s*\n/i);
    if (match) {
      const at = canonicalIdx + match[0].length;
      return html.slice(0, at) + insertion + html.slice(at);
    }
  }
  const titleClose = html.search(/<\/title>\s*\n/i);
  if (titleClose >= 0) {
    const match = html.match(/<\/title>\s*\n/i);
    if (match) {
      const at = titleClose + match[0].length;
      return html.slice(0, at) + insertion + html.slice(at);
    }
  }
  return html.replace(/<\/head>/i, `${insertion}</head>`);
}

function collapseHeadBlankLines(html: string): string {
  const headStart = html.search(/<head\b[^>]*>/i);
  const headEnd = html.search(/<\/head>/i);
  if (headStart < 0 || headEnd < 0 || headEnd < headStart) return html;
  const headTagMatch = html.slice(headStart).match(/<head\b[^>]*>/i);
  if (!headTagMatch) return html;
  const headContentStart = headStart + headTagMatch[0].length;
  const head = html.slice(headContentStart, headEnd);
  // Collapse runs of >=2 newlines into a single newline. This is conservative:
  // it doesn't touch the rest of the document or the indentation of meta tags.
  const collapsed = head.replace(/\n[\s\t]*\n+/g, '\n');
  return html.slice(0, headContentStart) + collapsed + html.slice(headEnd);
}
