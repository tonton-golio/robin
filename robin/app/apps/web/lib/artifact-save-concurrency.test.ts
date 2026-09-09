import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { VaultConflictError } from "@robin/vault-io";

const { writeWithHistoryMock, refreshIndexPathsMock } = vi.hoisted(() => ({
  writeWithHistoryMock: vi.fn(),
  refreshIndexPathsMock: vi.fn(),
}));

vi.mock("@robin/vault-io", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@robin/vault-io")>();
  return { ...actual, writeWithHistory: writeWithHistoryMock };
});

vi.mock("@/lib/indexer-client", () => ({
  refreshIndexPaths: refreshIndexPathsMock,
}));

vi.mock("@/lib/vault", () => ({
  locateVault: () => "/tmp/robin-artifact-save-concurrency-test",
  vaultPath: (relativePath: string) => `/tmp/robin-artifact-save-concurrency-test/${relativePath}`,
}));

import { POST as saveArtifact } from "@/app/api/artifact/save/route";

const UPPER_HASH = "AB".repeat(32);
const NORMALIZED_HASH = UPPER_HASH.toLowerCase();

function artifactSaveRequest(): NextRequest {
  return new NextRequest("http://localhost:8400/api/artifact/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: "out/concurrent-artifact.html",
      html: "<!doctype html><title>Updated</title>",
      expected_hash: UPPER_HASH,
    }),
  });
}

describe("artifact save optimistic concurrency", () => {
  beforeEach(() => {
    writeWithHistoryMock.mockReset();
    refreshIndexPathsMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the committed write when the post-commit index refresh fails", async () => {
    writeWithHistoryMock.mockResolvedValue({
      written: true,
      beforeHash: NORMALIZED_HASH,
      afterHash: "cd".repeat(32),
      absolutePath: "/tmp/robin-artifact-save-concurrency-test/out/concurrent-artifact.html",
      origin: "web",
      event: null,
    });
    refreshIndexPathsMock.mockRejectedValue(new Error("index unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await saveArtifact(artifactSaveRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      written: true,
      before_hash: NORMALIZED_HASH,
      after_hash: "cd".repeat(32),
    });
    expect(writeWithHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ expectedHash: NORMALIZED_HASH }),
    );
    expect(refreshIndexPathsMock).toHaveBeenCalledWith(["out/concurrent-artifact.html"]);
    expect(warning).toHaveBeenCalledWith(
      "[artifact/save] write committed but index refresh failed:",
      expect.any(Error),
    );
  });

  it("returns 409 for a stale artifact without refreshing the index", async () => {
    writeWithHistoryMock.mockRejectedValue(
      new VaultConflictError(NORMALIZED_HASH, "ef".repeat(32)),
    );

    const response = await saveArtifact(artifactSaveRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "conflict: the artifact changed on disk; reload and merge before saving",
    });
    expect(refreshIndexPathsMock).not.toHaveBeenCalled();
  });

  it("requires a content hash instead of allowing an unconditional overwrite", async () => {
    const request = new NextRequest("http://localhost:8400/api/artifact/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "out/concurrent-artifact.html",
        html: "<!doctype html><title>Stale</title>",
      }),
    });

    const response = await saveArtifact(request);
    expect(response.status).toBe(428);
    expect(writeWithHistoryMock).not.toHaveBeenCalled();
  });
});
