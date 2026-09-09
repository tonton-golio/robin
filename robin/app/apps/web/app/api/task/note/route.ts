/**
 * POST /api/task/note
 *
 * Append a dated note to a task's body — the board's "leave a comment"
 * affordance. Body: { path: string, text: string }
 *
 * Notes accumulate under a single "Log" heading at the end of the task body
 * (added once, marked with data-robin-log). This keeps comments in the task page
 * itself — durable, greppable, and visible when the page is opened — rather than
 * a parallel store. Reuses the same data-safe read→canonicalize→write recipe as
 * /api/task/update: body + title + every robin:* tag are preserved.
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
} from "@robin/converter";
import { hashHtml, VaultConflictError } from "@robin/vault-io";
import { parseRobinHtml } from "@/lib/read-page";
import { writePage } from "@/lib/write-page";
import { normalizeVaultFilePath, absoluteVaultFilePath } from "@/lib/vault-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { path?: string; text?: string };
  try {
    body = (await request.json()) as { path?: string; text?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const filePath = body.path;
  const text = (body.text ?? "").trim();
  if (!filePath || !filePath.endsWith(".html")) {
    return NextResponse.json({ error: "missing or invalid path" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "empty note" }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: "note too long" }, { status: 400 });
  }

  const safePath = normalizeVaultFilePath(filePath);
  if (!safePath || !safePath.startsWith("brain/tasks/")) {
    return NextResponse.json({ error: "not a task page" }, { status: 400 });
  }

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

  const core = parseRobinHtmlCore(html);
  const meta = extractMetaFromMap(core.metaMap, safePath);
  const extraMeta = collectExtraMetaTags(core.metaMap);
  const page = parseRobinHtml(html, safePath, mtime);
  const title = page.title || core.title || meta.slug;

  // Append the note. Add the "Log" heading once (idempotent via data-robin-log).
  const date = new Date().toISOString().slice(0, 10);
  const noteHtml = `<p data-robin-note><strong>${date}</strong> · ${escapeHtml(text)}</p>`;
  const hasLog = /data-robin-log/.test(page.bodyHtml);
  const addition = hasLog ? noteHtml : `<h2 data-robin-log>Log</h2>${noteHtml}`;
  const newBody = `${page.bodyHtml}\n${addition}`;

  const fm = frontmatterFromMeta(meta);
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
    bodyHtml: newBody,
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
        { error: "task changed while the note was being added; reload and retry" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "write failed" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, path: safePath, date },
    { status: 200, headers: { "X-Robin-Self-Write": "1" } },
  );
}
