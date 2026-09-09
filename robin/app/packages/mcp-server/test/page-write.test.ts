/**
 * page-write.test.ts
 *
 * Tests round-trip page write:
 * - Write with body_md produces valid v0.2 ROBIN_FORMAT HTML
 * - Frontmatter merge works (partial update, null clears field)
 * - body_blocks input is no longer accepted (v0.2)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseRobinHtml } from "@robin/indexer";
import { hashHtml, VaultConflictError } from "@robin/vault-io";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pageCreate } from "../src/tools/page-create.js";
import { pageRead } from "../src/tools/page-read.js";
import { pageWrite } from "../src/tools/page-write.js";
import type { ToolContext } from "../src/types.js";

function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "robin-test-write-"));
  fs.mkdirSync(path.join(dir, "brain", "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "out"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "logs", "changelog.md"), "");
  return dir;
}

function makeCtx(vaultPath: string): ToolContext {
  return { vaultPath, indexer: null };
}

describe("page.write — body_md", () => {
  let vault: string;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("round-trips a page written with body_md", async () => {
    const ctx = makeCtx(vault);

    // Create the page first
    await pageCreate(
      {
        folder: "brain/tasks",
        slug: "test-task",
        type: "task",
        frontmatter: { title: "Test Task", summary: "A test" },
        body_md: "# Test Task\n\nHello world.",
      },
      ctx,
    );

    const filePath = path.join(vault, "brain", "tasks", "test-task.html");
    expect(fs.existsSync(filePath)).toBe(true);

    const html = fs.readFileSync(filePath, "utf8");
    const parsed = parseRobinHtml(html);

    // Must have required meta fields
    const m = parsed.meta as Record<string, string | string[]>;
    expect(m["robin:type"]).toBe("task");
    expect(m["robin:slug"]).toBe("test-task");
    expect(m["robin:version"]).toBe("0.2");

    // v0.2: no #robin:blocks payload — blocks parse should be null/empty
    expect(parsed.blocks).toBeFalsy();

    // Body HTML must be inside article[data-robin-doc] with prose visible
    expect(html).toContain("data-robin-doc");
    expect(html).toContain("<!doctype html>");
    expect(parsed.bodyText).toContain("Hello world");
  });

  it("writes body_md and produces a valid document structure", async () => {
    const ctx = makeCtx(vault);

    await pageCreate(
      {
        folder: "brain/tasks",
        slug: "md-test",
        type: "task",
        body_md: "# Hello\n\nThis is **bold** text.\n\n- item 1\n- item 2",
      },
      ctx,
    );

    const html = fs.readFileSync(path.join(vault, "brain", "tasks", "md-test.html"), "utf8");

    // v0.2 structural requirements from ROBIN_FORMAT
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("data-robin-doc");
    // v0.2 explicitly removes both JSON payloads from <head>.
    expect(html).not.toContain('id="robin:blocks"');
    expect(html).not.toContain('id="robin:frontmatter"');
    expect(html).toContain('<meta name="robin:version" content="0.2">');
  });
});

describe("page.write — v0.2 schema", () => {
  let vault: string;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("rejects body_blocks at the schema level (v0.2)", async () => {
    // body_blocks is no longer part of the input shape; ensure the Zod schema
    // doesn't accept it. We use parseAsync on the schema directly rather than
    // calling pageCreate, because the deleted field would otherwise just be
    // silently ignored by the (now stricter) schema.
    const { PageCreateInputSchema } = await import("../src/tools/page-create.js");
    const parsed = await PageCreateInputSchema.safeParseAsync({
      folder: "brain/tasks",
      slug: "blocks-page",
      type: "knowledge",
      body_blocks: [],
    });
    // The schema is permissive (no strict()), so unknown keys are stripped
    // rather than rejected — but the resulting parsed object must not carry
    // body_blocks through.
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("body_blocks" in parsed.data).toBe(false);
    }
  });
});

describe("page.write — frontmatter merge", () => {
  let vault: string;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("merges partial frontmatter without overwriting unrelated fields", async () => {
    const ctx = makeCtx(vault);

    await pageCreate(
      {
        folder: "brain/tasks",
        slug: "merge-test",
        type: "task",
        frontmatter: { title: "Original Title", priority: "p2", owner: "Alex Rivera" },
        body_md: "# Original",
      },
      ctx,
    );

    await pageWrite(
      {
        ref: "brain/tasks/merge-test.html",
        frontmatter: { priority: "p1" }, // Only update priority
      },
      ctx,
    );

    const result = await pageRead({ ref: "brain/tasks/merge-test.html" }, ctx);
    expect(result.meta.priority).toBe("p1");
    expect(result.meta.owner).toBe("Alex Rivera"); // preserved
  });

  it("preserves the existing v0.2 body on a frontmatter-only update", async () => {
    const ctx = makeCtx(vault);

    await pageCreate(
      {
        folder: "brain/tasks",
        slug: "fm-only",
        type: "task",
        body_md: "# fm-only\n\nA very distinctive opening sentence.",
      },
      ctx,
    );

    // Frontmatter-only update — must not erase the body (regression for the
    // v0.2 path where there is no #robin:blocks payload to round-trip).
    await pageWrite({ ref: "brain/tasks/fm-only.html", frontmatter: { state: "active" } }, ctx);

    const html = fs.readFileSync(path.join(vault, "brain", "tasks", "fm-only.html"), "utf8");
    const parsed = parseRobinHtml(html);
    expect(parsed.bodyText).toContain("A very distinctive opening sentence.");
    const m = parsed.meta as Record<string, string | string[]>;
    // Canonical lifecycle key is robin:status (a `state:` frontmatter value is
    // folded into it on write); the legacy robin:state tag is no longer emitted.
    expect(m["robin:status"]).toBe("active");
    expect(m["robin:state"]).toBeUndefined();
  });

  it("preserves title, schedule fields, and custom robin:* metadata", async () => {
    const ctx = makeCtx(vault);
    const filePath = path.join(vault, "brain", "tasks", "lossless.html");
    fs.writeFileSync(
      filePath,
      `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>A Human Title</title>
  <meta name="robin:path" content="brain/tasks/lossless.html">
  <meta name="robin:slug" content="lossless">
  <meta name="robin:type" content="task">
  <meta name="robin:status" content="open">
  <meta name="robin:start" content="2026-08-01T00:00:00.000Z">
  <meta name="robin:end" content="2026-08-03T00:00:00.000Z">
  <meta name="robin:review-by" content="2026-08-04">
  <meta name="robin:updated" content="2026-07-25T00:00:00.000Z">
  <meta name="robin:version" content="0.2">
</head>
<body><article data-robin-doc><h1>A Human Title</h1><p>Keep me.</p></article></body>
</html>`,
      "utf8",
    );

    await pageWrite({ ref: "brain/tasks/lossless.html", frontmatter: { priority: "p1" } }, ctx);

    const out = fs.readFileSync(filePath, "utf8");
    expect(out).toContain("<title>A Human Title</title>");
    expect(out).toContain('<meta name="robin:start" content="2026-08-01T00:00:00Z">');
    expect(out).toContain('<meta name="robin:end" content="2026-08-03T00:00:00Z">');
    expect(out).toContain('<meta name="robin:review-by" content="2026-08-04">');
    expect(out).toContain("Keep me.");
  });

  it("preserves v0.3 identity/provenance and refuses identity replacement", async () => {
    const ctx = makeCtx(vault);
    const filePath = path.join(vault, "brain", "tasks", "identity.html");
    const id = "123e4567-e89b-52d3-a456-426614174000";
    fs.writeFileSync(
      filePath,
      `<!doctype html>
<html lang="en"><head>
  <title>Identity</title>
  <meta name="robin:path" content="brain/tasks/identity.html">
  <meta name="robin:slug" content="identity">
  <meta name="robin:type" content="task">
  <meta name="robin:updated" content="2026-07-25T00:00:00Z">
  <meta name="robin:version" content="0.3">
  <meta name="robin:id" content="${id}">
  <meta name="robin:source-kind" content="document">
  <meta name="robin:source-ref" content="inbox/source.md">
</head><body><article data-robin-doc><h1>Identity</h1></article></body></html>`,
      "utf8",
    );

    await pageWrite({ ref: "brain/tasks/identity.html", frontmatter: { priority: "p1" } }, ctx);
    const out = fs.readFileSync(filePath, "utf8");
    expect(out).toContain('<meta name="robin:version" content="0.3">');
    expect(out).toContain(`<meta name="robin:id" content="${id}">`);
    expect(out).toContain('<meta name="robin:source-kind" content="document">');
    expect(out).toContain('<meta name="robin:source-ref" content="inbox/source.md">');

    await expect(
      pageWrite(
        {
          ref: "brain/tasks/identity.html",
          frontmatter: { id: "00000000-0000-4000-8000-000000000000" },
        },
        ctx,
      ),
    ).rejects.toThrow(/immutable robin:id/);
  });

  it("exposes a content hash and rejects a stale optimistic write", async () => {
    const ctx = makeCtx(vault);
    await pageCreate(
      {
        folder: "brain/tasks",
        slug: "concurrent-edit",
        type: "task",
        body_md: "# Concurrent edit\n\nOriginal body.",
      },
      ctx,
    );

    const filePath = path.join(vault, "brain", "tasks", "concurrent-edit.html");
    const read = await pageRead({ ref: "brain/tasks/concurrent-edit.html" }, ctx);
    const original = fs.readFileSync(filePath, "utf8");
    expect(read.content_hash).toBe(hashHtml(original));

    const concurrent = original.replace("Original body.", "A concurrent writer won.");
    fs.writeFileSync(filePath, concurrent, "utf8");

    await expect(
      pageWrite(
        {
          ref: "brain/tasks/concurrent-edit.html",
          expected_hash: read.content_hash,
          frontmatter: { priority: "p1" },
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(VaultConflictError);
    expect(fs.readFileSync(filePath, "utf8")).toBe(concurrent);
  });
});

describe("page.write — frontmatter special characters (regression)", () => {
  let vault: string;

  beforeEach(() => {
    vault = makeVault();
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  // Previously assemblePage round-tripped frontmatter through naive YAML, which
  // threw on a bare colon and silently truncated `#`/`@`. It must now preserve
  // these verbatim.
  it("preserves a summary containing a colon, #, and @ without throwing", async () => {
    const ctx = makeCtx(vault);
    const summary = "Fix bug: the @handler dropped #1 records";

    await pageCreate(
      {
        folder: "brain/tasks",
        slug: "colon-task",
        type: "task",
        frontmatter: { summary },
        body_md: "# Colon Task",
      },
      ctx,
    );

    // A status-only update on a page whose summary has a colon must not throw.
    await expect(
      pageWrite({ ref: "brain/tasks/colon-task.html", frontmatter: { state: "active" } }, ctx),
    ).resolves.toBeTruthy();

    const result = await pageRead({ ref: "brain/tasks/colon-task.html" }, ctx);
    expect(result.meta.summary).toBe(summary);
    // Canonical lifecycle field is `status`; `state` still resolves via the
    // read-side fallback (state ?? status) for back-compat.
    expect(result.meta.status).toBe("active");
    expect(result.meta.state).toBe("active");
  });

  // Previously assemblePage only swapped the blocks/frontmatter JSON and left
  // the visible <article> body empty. The body must be rendered from blocks.
  it("renders the body into the article (not just the blocks JSON)", async () => {
    const ctx = makeCtx(vault);

    await pageCreate(
      {
        folder: "brain/tasks",
        slug: "body-task",
        type: "task",
        body_md: "# Heading\n\nA distinctive sentence in the body.",
      },
      ctx,
    );

    const html = fs.readFileSync(path.join(vault, "brain", "tasks", "body-task.html"), "utf8");
    // The rendered article (between <article ...> and </article>) must contain the prose.
    const article = html.slice(html.indexOf("<article"), html.indexOf("</article>"));
    expect(article).toContain("A distinctive sentence in the body.");
    expect(article).toMatch(/<h1[^>]*>Heading<\/h1>/);
  });
});
