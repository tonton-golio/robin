import { describe, expect, it } from "vitest";
import { resolveMovedHtmlPathFromEvents } from "./moved-path";

const moved = (previous_path: string, page_path: string) => ({
  event: "edit.moved" as const,
  previous_path,
  page_path,
});

function servable(...paths: string[]): (relPath: string) => Promise<boolean> {
  const existing = new Set(paths);
  return async (relPath) => existing.has(relPath);
}

describe("resolveMovedHtmlPathFromEvents", () => {
  it("follows a move chain to its existing destination", async () => {
    const events = [
      moved("out/old.html", "out/archive/old.html"),
      moved("out/archive/old.html", "out/archived/old.html"),
    ];
    await expect(
      resolveMovedHtmlPathFromEvents("out/old.html", events, servable("out/archived/old.html")),
    ).resolves.toBe("out/archived/old.html");
  });

  it("lets an existing requested path win over stale move history", async () => {
    await expect(
      resolveMovedHtmlPathFromEvents(
        "out/old.html",
        [moved("out/old.html", "out/archive/old.html")],
        servable("out/old.html", "out/archive/old.html"),
      ),
    ).resolves.toBeNull();
  });

  it("uses the chronologically latest move when a source path was reused", async () => {
    const events = [
      { ...moved("out/old.html", "out/newest.html"), ts: "2026-09-09T10:00:00Z" },
      { ...moved("out/old.html", "out/stale.html"), ts: "2026-09-08T10:00:00Z" },
    ];
    await expect(
      resolveMovedHtmlPathFromEvents(
        "out/old.html",
        events,
        servable("out/newest.html", "out/stale.html"),
      ),
    ).resolves.toBe("out/newest.html");
  });

  it("rejects cycles and bounded chains", async () => {
    const cycle = [moved("out/a.html", "out/b.html"), moved("out/b.html", "out/a.html")];
    await expect(
      resolveMovedHtmlPathFromEvents("out/a.html", cycle, servable()),
    ).resolves.toBeNull();

    const chain = [moved("out/a.html", "out/b.html"), moved("out/b.html", "out/c.html")];
    await expect(
      resolveMovedHtmlPathFromEvents("out/a.html", chain, servable("out/c.html"), 1),
    ).resolves.toBeNull();
  });

  it("does not redirect when the destination is missing", async () => {
    await expect(
      resolveMovedHtmlPathFromEvents(
        "out/old.html",
        [moved("out/old.html", "out/archive/old.html")],
        servable(),
      ),
    ).resolves.toBeNull();
  });

  it("ignores traversal, non-canonical, non-HTML, and non-move ledger rows", async () => {
    const events = [
      moved("out/old.html", "out/../brain/private.html"),
      moved("out/old.html", "out/archive/old.pdf"),
      { event: "edit.saved" as const, previous_path: "out/old.html", page_path: "out/good.html" },
    ];
    await expect(
      resolveMovedHtmlPathFromEvents(
        "out/old.html",
        events,
        servable("brain/private.html", "out/good.html"),
      ),
    ).resolves.toBeNull();
    await expect(
      resolveMovedHtmlPathFromEvents(
        "../out/old.html",
        [moved("../out/old.html", "out/good.html")],
        servable("out/good.html"),
      ),
    ).resolves.toBeNull();
  });
});
