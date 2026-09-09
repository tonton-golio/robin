import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { VaultConflictError, hashHtml } from "@robin/vault-io";

const { writePageMock, vaultRoot } = vi.hoisted(() => ({
  writePageMock: vi.fn(),
  vaultRoot: { value: "" },
}));

vi.mock("@/lib/write-page", () => ({
  writePage: writePageMock,
}));

vi.mock("@/lib/vault-file", () => ({
  normalizeVaultFilePath: (value: string) => value,
  absoluteVaultFilePath: (relativePath: string) => `${vaultRoot.value}/${relativePath}`,
}));

import { POST as updateTask } from "@/app/api/task/update/route";

function taskPage(type = "task"): string {
  return `<!doctype html>
<html><head>
  <title>Human task title</title>
  <meta name="robin:version" content="0.2">
  <meta name="robin:path" content="brain/tasks/route-task.html">
  <meta name="robin:slug" content="route-task">
  <meta name="robin:type" content="${type}">
  <meta name="robin:status" content="in-progress">
  <meta name="robin:project" content="old-project">
  <meta name="robin:next_action" content="Old action">
  <meta name="robin:acceptance" content="Old acceptance">
  <meta name="robin:owner" content="Ada">
  <meta name="robin:review-by" content="2026-08-15">
  <meta name="robin:custom" content="preserve-me">
  <meta name="robin:updated" content="2026-08-01T00:00:00Z">
</head><body><article data-robin-doc><p>Distinctive body text.</p></article></body></html>`;
}

function request(patch: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:8400/api/task/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "brain/tasks/route-task.html", patch }),
  });
}

describe("POST /api/task/update", () => {
  let testVault: string;
  const pagePath = "brain/tasks/route-task.html";

  beforeAll(async () => {
    testVault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-task-update-"));
    vaultRoot.value = testVault;
  });

  afterAll(async () => {
    await fs.rm(testVault, { recursive: true, force: true });
  });

  beforeEach(async () => {
    writePageMock.mockReset();
    writePageMock.mockImplementation(
      async ({ vaultRelativePath, html }: { vaultRelativePath: string; html: string }) => {
        const absolute = path.join(vaultRoot.value, vaultRelativePath);
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, html, "utf8");
      },
    );
    const absolute = path.join(testVault, pagePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, taskPage(), "utf8");
  });

  it("rejects a non-task page under brain/tasks before writing", async () => {
    await fs.writeFile(path.join(testVault, pagePath), taskPage("note"), "utf8");

    const response = await updateTask(request({ owner: "Sam" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "not a task page" });
    expect(writePageMock).not.toHaveBeenCalled();
  });

  it("rejects invalid recognized metadata before reading or writing", async () => {
    const before = await fs.readFile(path.join(testVault, pagePath), "utf8");

    const response = await updateTask(request({ status: "not-a-status" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid task status" });
    expect(writePageMock).not.toHaveBeenCalled();
    await expect(fs.readFile(path.join(testVault, pagePath), "utf8")).resolves.toBe(before);
  });

  it("persists project fields, clears them, and preserves body and extra metadata", async () => {
    const original = await fs.readFile(path.join(testVault, pagePath), "utf8");
    const first = await updateTask(
      request({
        project: "new-project",
        next_action: "Do the thing",
        acceptance: "Evidence exists",
        owner: "Sam",
      }),
    );

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      ok: true,
      project: "new-project",
      next_action: "Do the thing",
      acceptance: "Evidence exists",
      owner: "Sam",
      status: "in-progress",
    });
    expect(writePageMock).toHaveBeenCalledWith(
      expect.objectContaining({ expectedHash: hashHtml(original) }),
    );

    const written = await fs.readFile(path.join(testVault, pagePath), "utf8");
    expect(written).toContain("Distinctive body text.");
    expect(written).toContain('name="robin:review-by" content="2026-08-15"');
    expect(written).toContain('name="robin:custom" content="preserve-me"');
    expect(written).toContain('name="robin:project" content="new-project"');

    const cleared = await updateTask(
      request({ project: null, next_action: "", acceptance: null }),
    );

    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({
      ok: true,
      owner: "Sam",
      status: "in-progress",
    });
    const clearedHtml = await fs.readFile(path.join(testVault, pagePath), "utf8");
    expect(clearedHtml).not.toContain('name="robin:project"');
    expect(clearedHtml).not.toContain('name="robin:next_action"');
    expect(clearedHtml).not.toContain('name="robin:acceptance"');
    expect(clearedHtml).toContain("Distinctive body text.");
    expect(clearedHtml).toContain('name="robin:review-by" content="2026-08-15"');
    expect(clearedHtml).toContain('name="robin:custom" content="preserve-me"');
  });

  it("returns a conflict without treating a stale task as committed", async () => {
    writePageMock.mockRejectedValueOnce(new VaultConflictError("aa".repeat(32), "bb".repeat(32)));

    const response = await updateTask(request({ owner: "Sam" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "task changed while it was being updated; reload and retry",
    });
  });
});
