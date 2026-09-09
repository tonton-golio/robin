/**
 * POST /api/page/save
 *
 * Body: {
 *   path: string,
 *   frontmatter: Record<string, unknown>,
 *   blocks: RobinBlock[],
 *   expected_hash?: string
 * }
 * Response: 200 { ok: true } or 4xx/5xx { error: string }
 *
 * MCP-aware: if ROBIN_MCP_URL is set, proxies the write to MCP's page.write tool.
 * Otherwise writes directly to disk via write-page.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import type { RobinBlock } from "@robin/converter";
import {
  canonicalizeHtml,
  collectExtraMetaTags,
  extractMetaFromMap,
  frontmatterFromMeta,
  normalizeFrontmatter,
  parseRobinHtmlCore,
} from "@robin/converter";
import { hashHtml, VaultConflictError } from "@robin/vault-io";
import { writePage } from "@/lib/write-page";
import { normalizeVaultFilePath } from "@/lib/vault-file";
import { vaultPath } from "@/lib/vault";
import path from "path";
import fs from "fs/promises";

interface SaveBody {
  path: string;
  frontmatter: Record<string, unknown>;
  blocks: RobinBlock[];
  expected_hash?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { path: filePath, frontmatter, blocks, expected_hash: expectedHash } = body;

  if (!filePath || typeof filePath !== "string") {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }

  if (!filePath.endsWith(".html")) {
    return NextResponse.json({ error: "path must end with .html" }, { status: 400 });
  }

  if (
    expectedHash !== undefined &&
    (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(expectedHash))
  ) {
    return NextResponse.json(
      { error: "expected_hash must be a sha256 hex string" },
      { status: 400 },
    );
  }

  // Security: enforce the vault allowlist (brain/inbox/out/logs) and reject
  // `..`/absolute/null — a bare `startsWith('..')` check is bypassable.
  const safePath = normalizeVaultFilePath(filePath);
  if (!safePath) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  // MCP-aware path
  const mcpUrl = process.env["ROBIN_MCP_URL"];
  if (mcpUrl) {
    return await writeThroughMcp(mcpUrl, { ...body, path: safePath });
  }

  let currentHtml: string;
  try {
    currentHtml = await fs.readFile(vaultPath(safePath), "utf8");
  } catch {
    return NextResponse.json({ error: "page not found" }, { status: 404 });
  }
  const currentCore = parseRobinHtmlCore(currentHtml);
  const currentMeta = extractMetaFromMap(currentCore.metaMap, safePath);
  if (frontmatter["id"] !== undefined && frontmatter["id"] !== currentMeta.id) {
    return NextResponse.json(
      { error: "immutable robin:id cannot be changed through page save" },
      { status: 400 },
    );
  }
  const effectiveFrontmatter: Record<string, unknown> = {
    ...frontmatterFromMeta(currentMeta),
    ...frontmatter,
    version: currentMeta.version,
    ...(currentMeta.id ? { id: currentMeta.id } : {}),
  };
  if (!currentMeta.id) delete effectiveFrontmatter["id"];

  // Single source of truth: derive RobinMeta via the converter's
  // normalizeFrontmatter (correct version '0.2', status/state synonym handling,
  // size/date/tag/source coercion) instead of hand-building v0.1 meta here.
  // Keeps this legacy/MCP-facing route's output in lockstep with the server
  // action in lib/actions/page.ts and the indexer/reader expectations.
  const slug = path.basename(safePath, ".html");
  const title =
    typeof effectiveFrontmatter["title"] === "string"
      ? (effectiveFrontmatter["title"] as string)
      : currentCore.title || slug;
  const { meta } = normalizeFrontmatter({
    frontmatter: effectiveFrontmatter,
    slug,
    outputPath: safePath,
    title,
  });

  // Generate canonical HTML
  const html = canonicalizeHtml({
    meta,
    frontmatter: effectiveFrontmatter,
    blocks,
    extraMeta: collectExtraMetaTags(currentCore.metaMap),
  });

  try {
    await writePage({
      vaultRelativePath: safePath,
      html,
      expectedHash:
        typeof expectedHash === "string" ? expectedHash.toLowerCase() : hashHtml(currentHtml),
    });
  } catch (e) {
    if (e instanceof VaultConflictError) {
      return NextResponse.json(
        { error: "conflict: the page changed on disk; reload and merge before saving" },
        { status: 409 },
      );
    }
    console.error("[save] write failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "write failed" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, path: safePath, slug },
    {
      status: 200,
      headers: {
        "X-Robin-Self-Write": "1",
      },
    },
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function writeThroughMcp(mcpUrl: string, body: SaveBody): Promise<NextResponse> {
  try {
    const resp = await fetch(`${mcpUrl}/tools/page.write`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await resp.json()) as Record<string, unknown>;
    return NextResponse.json(json, {
      status: resp.status,
      headers: { "X-Robin-Self-Write": "1" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `MCP write failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}
