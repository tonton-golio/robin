/**
 * POST /api/task/update
 *
 * Field-level, data-safe mutation of a single task page from the Standup board.
 * Body: { path: string, patch: { status?, priority?, size?, due?, owner?,
 *         planned?, category?, kind?, parent? } }
 *
 * Safety contract (verified by a real round-trip before this shipped):
 *   - Reads the page, recovers its body HTML, human <title>, and EVERY robin:*
 *     meta tag the canonical writer can't express (robin:review-by, …) so a
 *     metadata-only edit preserves them instead of dropping them.
 *   - Writes the canonical `robin:status` only — never the legacy `robin:state`
 *     (the page converges to the convention on save).
 *   - `due` / `planned` accept '' to CLEAR the field (the inline unschedule).
 *   - Threads the original <title> into frontmatter.title so canonicalizeHtml
 *     does not silently fall back to the slug.
 *
 * Deliberately does NOT append a changelog line: the board is a rapid live-edit
 * surface (a changelog entry per status toggle would be noise). The shared
 * writer records history and refreshes the changed index path.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import {
  parseRobinHtmlCore,
  extractMetaFromMap,
  collectExtraMetaTags,
  normalizeFrontmatter,
  canonicalizeHtml,
  frontmatterFromMeta,
  normalizeTaskPatch,
  applyTaskPatch,
  type TaskPatch,
} from "@robin/converter";
import { hashHtml, VaultConflictError } from "@robin/vault-io";
import { parseRobinHtml } from "@/lib/read-page";
import { writePage } from "@/lib/write-page";
import { normalizeVaultFilePath, absoluteVaultFilePath } from "@/lib/vault-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpdateBody {
  path: string;
  patch: Record<string, unknown>;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { path: filePath, patch } = body;
  if (!filePath || typeof filePath !== "string") {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }
  if (!filePath.endsWith(".html")) {
    return NextResponse.json({ error: "path must end with .html" }, { status: 400 });
  }
  if (!patch || typeof patch !== "object") {
    return NextResponse.json({ error: "missing patch" }, { status: 400 });
  }

  // Enforce the vault allowlist (brain/inbox/out/logs) + reject `..`/absolute/NUL.
  const safePath = normalizeVaultFilePath(filePath);
  if (!safePath) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
  // The board only ever edits real task pages.
  if (!safePath.startsWith("brain/tasks/")) {
    return NextResponse.json({ error: "not a task page" }, { status: 400 });
  }

  let clean: TaskPatch;
  try {
    clean = normalizeTaskPatch(patch);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid task patch" }, { status: 400 });
  }
  if (!Object.keys(clean).length) return NextResponse.json({ error: "empty patch" }, { status: 400 });

  const abs = absoluteVaultFilePath(safePath);
  let html: string;
  let mtime: Date;
  try {
    const stat = await fs.stat(abs);
    mtime = stat.mtime;
    html = await fs.readFile(abs, "utf-8");
  } catch {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  // READ: meta + extra (non-vocabulary) robin:* tags from the raw <head>, plus
  // the serialized body + human <title> from the web reader.
  const core = parseRobinHtmlCore(html);
  const meta = extractMetaFromMap(core.metaMap, safePath);
  if (meta.type !== "task") return NextResponse.json({ error: "not a task page" }, { status: 400 });
  const extraMeta = collectExtraMetaTags(core.metaMap);
  const page = parseRobinHtml(html, safePath, mtime);
  const bodyHtml = page.bodyHtml;
  const title = page.title || core.title || meta.slug;

  // Reconstruct frontmatter from meta (v0.2 task pages carry no inline JSON
  // frontmatter — the <head> tags are authoritative), then apply the patch.
  const fm = applyTaskPatch(frontmatterFromMeta(meta), clean);
  fm.title = title;
  const now = new Date();
  fm.updated = now.toISOString();

  const { meta: normMeta } = normalizeFrontmatter({
    frontmatter: fm,
    slug: meta.slug,
    outputPath: safePath,
    title,
  });

  const out = canonicalizeHtml({
    meta: normMeta,
    frontmatter: fm,
    blocks: [],
    bodyHtml,
    extraMeta,
    updatedAt: now,
  });

  try {
    await writePage({
      vaultRelativePath: safePath,
      html: out,
      expectedHash: hashHtml(html),
    });
  } catch (e) {
    if (e instanceof VaultConflictError) {
      return NextResponse.json(
        { error: "task changed while it was being updated; reload and retry" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "write failed" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      path: safePath,
      slug: normMeta.slug,
      updated: normMeta.updated,
      status: normMeta.status,
      priority: normMeta.priority,
      size: normMeta.size,
      due: normMeta.due,
      start: normMeta.start,
      end: normMeta.end,
      planned: normMeta.planned,
      owner: normMeta.owner,
      category: normMeta.category,
      project: normMeta.project,
      next_action: normMeta.next_action,
      acceptance: normMeta.acceptance,
      kind: normMeta.kind,
      parent: normMeta.parent,
    },
    { status: 200, headers: { "X-Robin-Self-Write": "1" } },
  );
}
