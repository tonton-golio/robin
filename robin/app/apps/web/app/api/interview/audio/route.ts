/**
 * POST /api/interview/audio
 *
 * Accepts a multipart `audio` Blob plus the interview `slug` and optional
 * `durationSec`. Saves the answers-only microphone recording to:
 *   <vault>/inbox/interviews/audio/<timestamp>-<brief>-<id>.<ext>
 *
 * The xAI credential never enters this route or the browser. This endpoint is
 * only the durable local sink for the MediaRecorder output.
 */

import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fsyncDirectory } from "@robin/vault-io";
import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-request-guard";
import { safeInterviewSlug } from "@/lib/interview-constants";
import { vaultPath } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Two hours of 96 kbps Opus is roughly 86 MB. Leave ample headroom while
// rejecting runaway or malformed uploads before writing them to the vault.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

function extensionForMime(type: string): "webm" | "ogg" | "m4a" {
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4")) return "m4a";
  return "webm";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = guardApiRequest(request);
  if (denied) return denied;

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Answer recording is too large" }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart upload" }, { status: 400 });
  }

  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "A non-empty audio file is required" }, { status: 422 });
  }
  if (audio.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Answer recording is too large" }, { status: 413 });
  }

  const slug = safeInterviewSlug(String(formData.get("slug") ?? "interview"), "interview");
  const durationValue = Number(formData.get("durationSec"));
  const durationSec = Number.isFinite(durationValue) && durationValue >= 0 ? durationValue : null;
  const extension = extensionForMime(audio.type);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}-${slug}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  const audioDir = vaultPath("inbox", "interviews", "audio");
  const absPath = path.join(audioDir, filename);
  const partialPath = `${absPath}.partial`;
  const relativePath = path.posix.join("inbox", "interviews", "audio", filename);

  await fs.mkdir(audioDir, { recursive: true });

  try {
    await pipeline(
      Readable.fromWeb(audio.stream() as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(partialPath, { flags: "wx", mode: 0o600 }),
    );
    const handle = await fs.open(partialPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.link(partialPath, absPath);
    await fs.unlink(partialPath);
    await fsyncDirectory(audioDir);
  } catch {
    await fs.rm(partialPath, { force: true }).catch(() => {});
    return NextResponse.json({ error: "Could not save answer recording" }, { status: 500 });
  }

  return NextResponse.json({ audioPath: relativePath, durationSec, mimeType: audio.type });
}
