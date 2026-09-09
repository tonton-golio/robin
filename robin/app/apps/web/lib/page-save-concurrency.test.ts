import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { VaultConflictError } from "@robin/vault-io";

const { writePageMock, notifyIndexerWriteMock } = vi.hoisted(() => ({
  writePageMock: vi.fn(),
  notifyIndexerWriteMock: vi.fn(),
}));

vi.mock("@/lib/write-page", () => ({
  writePage: writePageMock,
  notifyIndexerWrite: notifyIndexerWriteMock,
}));

import { POST as savePageRoute } from "@/app/api/page/save/route";
import { POST as createPageRoute } from "@/app/api/page/create/route";
import { createPage, savePage } from "@/lib/actions/page";

const UPPER_HASH = "AB".repeat(32);
const NORMALIZED_HASH = UPPER_HASH.toLowerCase();

function pageSaveRequest(
  expectedHash?: unknown,
  frontmatter: Record<string, unknown> = { title: "Concurrent page" },
): NextRequest {
  return new NextRequest("http://localhost:8400/api/page/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: "brain/concurrent-page.html",
      frontmatter,
      blocks: [],
      ...(expectedHash === undefined ? {} : { expected_hash: expectedHash }),
    }),
  });
}

describe("page save optimistic concurrency", () => {
  let testVault: string;
  let originalVault: string | undefined;

  beforeAll(async () => {
    originalVault = process.env["ROBIN_VAULT"];
    testVault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-page-save-cas-"));
    process.env["ROBIN_VAULT"] = testVault;
  });

  afterAll(async () => {
    if (originalVault === undefined) delete process.env["ROBIN_VAULT"];
    else process.env["ROBIN_VAULT"] = originalVault;
    await fs.rm(testVault, { recursive: true, force: true });
  });

  beforeEach(async () => {
    writePageMock.mockReset();
    writePageMock.mockResolvedValue(undefined);
    notifyIndexerWriteMock.mockReset();
    notifyIndexerWriteMock.mockResolvedValue(undefined);
    const pagePath = path.join(testVault, "brain", "concurrent-page.html");
    await fs.mkdir(path.dirname(pagePath), { recursive: true });
    await fs.writeFile(
      pagePath,
      `<!doctype html>
<html><head>
  <title>Concurrent page</title>
  <meta name="robin:path" content="brain/concurrent-page.html">
  <meta name="robin:slug" content="concurrent-page">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-07-25T00:00:00Z">
  <meta name="robin:version" content="0.2">
</head><body><article data-robin-doc><h1>Concurrent page</h1></article></body></html>`,
      "utf8",
    );
  });

  it("validates and normalizes expected_hash in the page save API", async () => {
    const invalid = await savePageRoute(pageSaveRequest("not-a-sha256"));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "expected_hash must be a sha256 hex string",
    });
    expect(writePageMock).not.toHaveBeenCalled();

    const saved = await savePageRoute(pageSaveRequest(UPPER_HASH));
    expect(saved.status).toBe(200);
    expect(writePageMock).toHaveBeenCalledWith(
      expect.objectContaining({ expectedHash: NORMALIZED_HASH }),
    );
  });

  it("returns 409 when the page save API loses the compare-and-swap race", async () => {
    writePageMock.mockRejectedValueOnce(new VaultConflictError(NORMALIZED_HASH, "cd".repeat(32)));

    const response = await savePageRoute(pageSaveRequest(UPPER_HASH));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "conflict: the page changed on disk; reload and merge before saving",
    });
    expect(notifyIndexerWriteMock).not.toHaveBeenCalled();
  });

  it("preserves staged v0.3 identity and rejects identity replacement", async () => {
    const pagePath = path.join(testVault, "brain", "concurrent-page.html");
    const id = "4c0bba7d-4604-40c4-8ad9-535ce372f607";
    const v03 = (await fs.readFile(pagePath, "utf8"))
      .replace('content="0.2"', 'content="0.3"')
      .replace(
        "</head>",
        `  <meta name="robin:id" content="${id}">\n` +
          '  <meta name="robin:source-kind" content="document">\n' +
          '  <meta name="robin:source-ref" content="inbox/source.md">\n</head>',
      );
    await fs.writeFile(pagePath, v03, "utf8");

    const preserved = await savePageRoute(pageSaveRequest(undefined));
    expect(preserved.status).toBe(200);
    const written = writePageMock.mock.calls.at(-1)?.[0] as { html: string };
    expect(written.html).toContain('<meta name="robin:version" content="0.3">');
    expect(written.html).toContain(`<meta name="robin:id" content="${id}">`);
    expect(written.html).toContain('<meta name="robin:source-ref" content="inbox/source.md">');

    const rejected = await savePageRoute(
      pageSaveRequest(undefined, {
        title: "Concurrent page",
        id: "00000000-0000-4000-8000-000000000000",
      }),
    );
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toEqual({
      error: "immutable robin:id cannot be changed through page save",
    });
  });

  it("validates, normalizes, and reports conflicts through the server action", async () => {
    const invalid = await savePage({
      path: "brain/concurrent-page.html",
      frontmatter: { title: "Concurrent page" },
      blocks: [],
      expected_hash: "invalid",
    });
    expect(invalid).toEqual({
      ok: false,
      error: "expected_hash must be a sha256 hex string",
    });
    expect(writePageMock).not.toHaveBeenCalled();

    const saved = await savePage({
      path: "brain/concurrent-page.html",
      frontmatter: { title: "Concurrent page" },
      blocks: [],
      expected_hash: UPPER_HASH,
    });
    expect(saved.ok).toBe(true);
    expect(writePageMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedHash: NORMALIZED_HASH }),
    );

    writePageMock.mockRejectedValueOnce(new VaultConflictError(NORMALIZED_HASH, "ef".repeat(32)));
    const conflict = await savePage({
      path: "brain/concurrent-page.html",
      frontmatter: { title: "Concurrent page" },
      blocks: [],
      expected_hash: UPPER_HASH,
    });
    expect(conflict).toEqual({
      ok: false,
      error: "conflict: the page changed on disk; reload and merge before saving",
    });
  });

  it("keeps create paths create-only with expectedHash=null", async () => {
    const createBody = {
      folder: "brain",
      slug: "create-only-page",
      type: "note",
      frontmatter: { title: "Create-only page" },
      blocks: [],
    };

    const actionResult = await createPage(createBody);
    expect(actionResult.ok).toBe(true);

    const routeResult = await createPageRoute(
      new NextRequest("http://localhost:8400/api/page/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createBody),
      }),
    );
    expect(routeResult.status).toBe(200);
    expect(writePageMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ expectedHash: null }),
    );
    expect(writePageMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ expectedHash: null }),
    );
  });

  it("reports a create-only CAS race as a conflict", async () => {
    const createBody = {
      folder: "brain",
      slug: "raced-create-page",
      type: "note",
      frontmatter: { title: "Raced create page" },
      blocks: [],
    };
    writePageMock.mockRejectedValue(new VaultConflictError(null, "ab".repeat(32)));

    const actionResult = await createPage(createBody);
    expect(actionResult).toEqual({
      ok: false,
      error: "conflict",
      path: "brain/raced-create-page.html",
    });

    const routeResult = await createPageRoute(
      new NextRequest("http://localhost:8400/api/page/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createBody),
      }),
    );
    expect(routeResult.status).toBe(409);
    await expect(routeResult.json()).resolves.toEqual({
      error: "conflict",
      path: "brain/raced-create-page.html",
    });
  });
});
