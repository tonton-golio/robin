import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { convertMarkdown } from "@robin/converter";
import { safeInterviewSlug } from "@/lib/build-system-prompt";
import { vaultPageHref } from "@/lib/routes";
import { vaultPath } from "@/lib/vault";
import { notifyIndexerWrite, writePage } from "@/lib/write-page";

/**
 * POST /api/interview/transcript
 * Body: { markdown: string, slug: string }
 * Saves source transcript to inbox/interviews/ and rendered HTML to logs/interviews/.
 * Returns { path, htmlPath, slug, ingest }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { markdown?: string; slug?: string };
  try {
    body = (await req.json()) as { markdown?: string; slug?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { markdown, slug } = body;
  if (!markdown || typeof markdown !== "string") {
    return NextResponse.json({ error: "markdown is required" }, { status: 400 });
  }

  const safeSlug = safeInterviewSlug(slug, "interview");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  const filename = `${timestamp}-${safeSlug}.md`;
  const htmlFilename = `${timestamp}-${safeSlug}.html`;

  const sourceDir = vaultPath("inbox", "interviews");
  const interviewsDir = vaultPath("logs", "interviews");
  try {
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(interviewsDir, { recursive: true });
  } catch {
    // already exists
  }

  const absPath = path.join(sourceDir, filename);
  try {
    await fs.writeFile(absPath, markdown, "utf-8");
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to write file: ${String(e)}` },
      { status: 500 },
    );
  }

  const vaultRelPath = `inbox/interviews/${filename}`;
  const htmlRelPath = `logs/interviews/${htmlFilename}`;
  const markdownForRobin = markdown.startsWith("---\n")
    ? markdown
    : [
        "---",
        "type: interview",
        `date: ${new Date().toISOString().slice(0, 10)}`,
        `title: "${safeSlug}"`,
        `source_brief: ${safeSlug}`,
        "tags: [interview]",
        `updated: ${new Date().toISOString()}`,
        "---",
        "",
        markdown,
      ].join("\n");

  try {
    const converted = convertMarkdown(markdownForRobin, {
      outputPath: htmlRelPath,
      title: safeSlug,
    });
    await writePage({ vaultRelativePath: htmlRelPath, html: converted.html });
    void notifyIndexerWrite(htmlRelPath);
  } catch (e) {
    return NextResponse.json(
      {
        error: `Transcript saved as markdown but HTML ingest failed: ${String(e)}`,
        path: vaultRelPath,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    path: vaultRelPath,
    htmlPath: htmlRelPath,
    slug: safeSlug,
    filename,
    ingest: {
      status: "ingested",
      pageUrl: vaultPageHref(htmlRelPath),
    },
  });
}
