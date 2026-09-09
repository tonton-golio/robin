/**
 * POST /api/artifact/save
 *
 * Save a raw, pre-rendered HTML artifact into the vault's `out/` tree. Unlike
 * /api/page/save (which rebuilds a brain/ page from the block model), this endpoint
 * takes a complete HTML document verbatim — it is the write path for the deck
 * editor and the outputs editor, whose artifacts are authored as raw HTML.
 *
 * Contract:
 *   Body:     { path: string, html: string, expected_hash: string, summary?: string, actor?: string }
 *   Response: 200 { written, before_hash, after_hash } | 4xx/5xx { error }
 *
 * `path` must be vault-relative, resolve inside the vault, end in `.html`, and
 * live under `out/`. Every write flows through @robin/vault-io `writeWithHistory`
 * (origin 'web'), so it is snapshotted + logged like any other page write.
 */

import { NextRequest, NextResponse } from "next/server";
import { VaultConflictError, writeWithHistory } from "@robin/vault-io";
import { locateVault, vaultPath } from "@/lib/vault";
import { normalizeVaultFilePath } from "@/lib/vault-file";
import { refreshIndexPaths } from "@/lib/indexer-client";

/** ~15MB: decks embed base64 images, so the raw HTML can be large. */
const MAX_HTML_BYTES = 15 * 1024 * 1024;

interface ArtifactSaveBody {
  path?: unknown;
  html?: unknown;
  summary?: unknown;
  actor?: unknown;
  expected_hash?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: ArtifactSaveBody;
  try {
    body = (await request.json()) as ArtifactSaveBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { path: filePath, html, summary, actor, expected_hash: expectedHash } = body;

  if (typeof filePath !== "string" || !filePath.trim()) {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }
  if (typeof html !== "string") {
    return NextResponse.json({ error: "missing html" }, { status: 400 });
  }
  if (!filePath.endsWith(".html")) {
    return NextResponse.json({ error: "path must end with .html" }, { status: 400 });
  }
  if (summary !== undefined && typeof summary !== "string") {
    return NextResponse.json({ error: "summary must be a string" }, { status: 400 });
  }
  if (actor !== undefined && typeof actor !== "string") {
    return NextResponse.json({ error: "actor must be a string" }, { status: 400 });
  }
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
    return NextResponse.json(
      { error: "expected_hash is required and must be a sha256 hex string" },
      { status: 428 },
    );
  }

  // Use the configured owner or the generic human role. For supplied labels, strip
  // control chars (they'd corrupt the JSONL edit event) and bound its length.
  const defaultActor = (process.env.ROBIN_OWNER ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64) || "human";
  let safeActor = defaultActor;
  if (typeof actor === "string") {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: edit-log actor labels cannot contain control characters
    const cleaned = actor.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    safeActor = (cleaned || defaultActor).slice(0, 64);
  }
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return NextResponse.json({ error: "html too large" }, { status: 413 });
  }

  // Normalize + containment-check (rejects `..`, absolute, NUL, off-allowlist).
  const safePath = normalizeVaultFilePath(filePath);
  if (!safePath) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
  // This endpoint owns out/ artifacts only; brain/ pages keep the block-model path.
  if (!safePath.startsWith("out/")) {
    return NextResponse.json({ error: "path must be under out/" }, { status: 400 });
  }

  const absolutePath = vaultPath(safePath);

  try {
    const res = await writeWithHistory({
      absolutePath,
      html,
      origin: "web",
      vaultRoot: locateVault(),
      actor: safeActor,
      expectedHash: expectedHash.toLowerCase(),
      ...(summary ? { summary } : {}),
    });
    if (res.written) {
      try {
        await refreshIndexPaths([safePath]);
      } catch (indexError) {
        console.warn("[artifact/save] write committed but index refresh failed:", indexError);
      }
    }
    return NextResponse.json(
      { written: res.written, before_hash: res.beforeHash, after_hash: res.afterHash },
      { status: 200, headers: { "X-Robin-Self-Write": "1" } },
    );
  } catch (e) {
    if (e instanceof VaultConflictError) {
      return NextResponse.json(
        { error: "conflict: the artifact changed on disk; reload and merge before saving" },
        { status: 409 },
      );
    }
    console.error("[artifact/save] write failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "write failed" },
      { status: 500 },
    );
  }
}
