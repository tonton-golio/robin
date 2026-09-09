import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  censusOf,
  deriveLedger,
  extentOf,
  gutterFrom,
  handlingFlagOf,
  inferredSubject,
  isArchivedPath,
  parseFacts,
  recipientOf,
  scopeOf,
  seriesOf,
  stateOf,
  titleOf,
} from "./derive";
import type { OutputItem } from "@/lib/catalog";
import type { OutputView } from "./types";

const originalVault = process.env["ROBIN_VAULT"];
const temporaryVaults: string[] = [];

afterEach(async () => {
  if (originalVault === undefined) delete process.env["ROBIN_VAULT"];
  else process.env["ROBIN_VAULT"] = originalVault;
  await Promise.all(temporaryVaults.splice(0).map((dir) => fs.rm(dir, { recursive: true })));
});

/**
 * Fixture-based coverage for the pure extraction layer.
 *
 * Every claim /outputs makes about an artifact — who it was for, what it is
 * called, whether anyone declared its state, how big it is, what it is flagged
 * for, whether it belongs to a batch — comes from these functions. They are
 * heuristics over other people's HTML, so the shapes that must NOT match
 * ("Transport for London", a chart tooltip <title>, the bulk-touched archive
 * directory) are asserted as explicitly as the shapes that must.
 *
 * Most filesystem plumbing stays outside these tests; one integration fixture
 * covers path-based archive classification through the complete derivation.
 */

const doc = (body: string, head = ""): string =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("parseFacts + recipientOf", () => {
  it("quotes the deck cover eyebrow verbatim", () => {
    const facts = parseFacts(
      doc(
        `<section class="slide cover">
           <p class="eyebrow">Board Review · June 4, 2026 · for Board &amp; Finance</p>
           <h1>The AI Bet, Halfway In</h1>
         </section>`,
      ),
    );
    const r = recipientOf(facts);
    expect(r.grade).toBe("quoted");
    expect(r.text).toBe("Board & Finance");
    expect(r.quote).toBe("Board Review · June 4, 2026 · for Board & Finance");
    expect(r.source).toBe("section.slide.cover .eyebrow");
  });

  it("takes the tightest node in a report cover block and drops the date segment", () => {
    const facts = parseFacts(
      doc(
        `<div class="meta"><span>Prepared for Client Alpha · July 2026</span></div><h1>DEMO agent hierarchy</h1>`,
      ),
    );
    const r = recipientOf(facts);
    expect(r.grade).toBe("quoted");
    expect(r.text).toBe("Client Alpha");
    expect(r.quote).toBe("Prepared for Client Alpha · July 2026");
  });

  it('does not fire on a mid-sentence "for" — "Transport for London" is not an addressee', () => {
    const facts = parseFacts(
      doc(`<p>Transport for London appears in the budget table.</p><h1>2026 Budget</h1>`),
    );
    expect(facts.recipient).toBeUndefined();
    expect(recipientOf(facts).grade).toBe("none");
  });

  it("falls back to robin:summary only when the summary itself names an addressee", () => {
    const facts = parseFacts(doc(`<h1>Notes</h1>`));
    expect(recipientOf(facts, "Prepared for Client Delta · July 2026").text).toBe("Client Delta");
    expect(recipientOf(facts, "A summary with no addressee in it").grade).toBe("none");
  });

  it('returns "none" rather than half a sentence when the tail is not a name list', () => {
    expect(
      gutterFrom(
        "Recruiting deck for Alex's personal LinkedIn — backfilling the pipeline after Q2",
      ),
    ).toBeUndefined();
  });

  it("reads the archive banner and its successor path, but only an out/ one", () => {
    const facts = parseFacts(
      doc(
        `<blockquote>Archived 2026-07-01 — superseded by <code>out/presentations/2026-07-budget-review.html</code></blockquote><h1>Old deck</h1>`,
      ),
    );
    expect(facts.archived).toEqual({
      date: "2026-07-01",
      successor: "out/presentations/2026-07-budget-review.html",
    });
  });

  it("collects only relative image sources, since absolute ones are not ours to stat", () => {
    const facts = parseFacts(
      doc(`<img src="chart.png"><img src="/api/file/x.png"><img src="https://x/y.png"><h1>T</h1>`),
    );
    expect(facts.relImages).toEqual(["chart.png"]);
  });
});

describe("titleOf", () => {
  it("takes the FIRST <title>, so an inline-SVG chart tooltip cannot name the artifact", () => {
    const facts = parseFacts(
      doc(
        `<h1>Example Automation</h1><svg><title>2026-07: 0 merged</title></svg>`,
        "<title>Alex — the founder’s log</title>",
      ),
    );
    expect(facts.firstTitle).toBe("Alex — the founder’s log");
    expect(titleOf(facts, undefined, "alex")).toBe("Alex — the founder’s log");
  });

  it("falls back to the first <h1>, then to the catalog filename", () => {
    const noTitle = parseFacts(doc(`<h1>Coding challenge — before / after</h1>`));
    expect(titleOf(noTitle, undefined, "coding challenge")).toBe(
      "Coding challenge — before / after",
    );
    expect(titleOf(parseFacts(doc("<p>nothing</p>")), undefined, "some file")).toBe("some file");
  });

  it("lets a markdown heading win, because .md has no <title> at all", () => {
    expect(titleOf(null, "Head of AI Alignment Audit", "head-of-ai")).toBe(
      "Head of AI Alignment Audit",
    );
  });
});

describe("stateOf", () => {
  it("reads the legacy robin:state key and names it", () => {
    expect(stateOf({ "robin:state": ["stable"] })).toEqual({
      state: "STABLE",
      source: "robin:state",
    });
  });

  it("reads the canonical robin:status key too", () => {
    expect(stateOf({ "robin:status": ["draft"] })).toEqual({
      state: "DRAFT",
      source: "robin:status",
    });
  });

  it("degrades to UNSTATED with no source — never to a flattering default", () => {
    expect(stateOf({})).toEqual({ state: "UNSTATED" });
    expect(stateOf({ "robin:summary": ["x"] }).state).toBe("UNSTATED");
  });

  it("picks up state from a parsed document end to end", () => {
    const facts = parseFacts(doc("<h1>T</h1>", '<meta name="robin:state" content="archived">'));
    expect(stateOf(facts.meta).state).toBe("ARCHIVED");
  });
});

describe("extentOf", () => {
  const base = { size: 0, slides: 0 };
  it("uses bytes only where bytes are the honest measure", () => {
    expect(
      extentOf({ ...base, relPath: "out/video/v5.mp4", ext: "mp4", size: 10.4 * 1024 * 1024 })
        .extent,
    ).toBe("Video · 10.4 MB");
    expect(extentOf({ ...base, relPath: "out/x.pptx", ext: "pptx", size: 86016 }).extent).toBe(
      "PPTX · 84 KB",
    );
  });

  it("counts slides, md lines and falls back to the honest one-page floor", () => {
    expect(extentOf({ ...base, relPath: "out/d.html", ext: "html", slides: 24 })).toEqual({
      extent: "Deck · 24 slides",
      extentShort: "Deck · 24",
    });
    expect(extentOf({ ...base, relPath: "out/a.md", ext: "md", mdLines: 260 })).toEqual({
      extent: "MD · 260 lines",
      extentShort: "MD · 260",
    });
    expect(extentOf({ ...base, relPath: "out/presentations/c.html", ext: "html" }).extent).toBe(
      "Diagram · 1 page",
    );
    expect(extentOf({ ...base, relPath: "out/reports/r.html", ext: "html" }).extent).toBe(
      "Doc · 1 page",
    );
  });
});

describe("handlingFlagOf", () => {
  it("quotes the document’s own sentence back, and prefers it over the tag", () => {
    const facts = parseFacts(
      doc(
        `<p>This is not a shareable artifact — do not send it outside the AI team.</p><h1>T</h1>`,
      ),
    );
    const flag = handlingFlagOf(facts.handling, ["sensitive"]);
    expect(flag?.label).toBe("do not send");
    expect(flag?.tone).toBe("warn");
    expect(flag?.title).toContain("not a shareable artifact");
  });

  it("falls back to the sensitive tag, and stays absent otherwise", () => {
    expect(handlingFlagOf(undefined, ["Sensitive"])?.label).toBe("sensitive");
    expect(handlingFlagOf(undefined, ["deck", "board"])).toBeUndefined();
  });
});

describe("scopeOf", () => {
  const quoted = (text: string) => ({ text, grade: "quoted" as const });

  it("classifies the quoted addressee, and says so in the group header", () => {
    expect(scopeOf(quoted("Client Alpha"), false, false)).toBe("outside");
    expect(scopeOf(quoted("Board & Finance"), false, false)).toBe("board");
    expect(scopeOf(quoted("Editorial"), false, false)).toBe("team");
    expect(scopeOf(quoted("Alex"), false, false, { owner: "Alex", external: [], leadership: [] })).toBe("human");
  });

  it("uses configured recipient aliases without matching partial names", () => {
    const config = { owner: "Alex", external: ["Cloud Library"], leadership: ["Rowan"] };
    expect(scopeOf(quoted("Cloud Library"), false, false, config)).toBe("outside");
    expect(scopeOf(quoted("Rowan & Sky"), false, false, config)).toBe("board");
    expect(scopeOf(quoted("Alexandra"), false, false, config)).toBe("team");
    expect(scopeOf(quoted("Rowanwood"), false, false, config)).toBe("team");
    expect(scopeOf(quoted("Unknown group"), false, false, config)).toBe("team");
  });

  it("puts an absent recipient in its own visible group, never a hidden bucket", () => {
    expect(scopeOf({ text: "", grade: "none" }, false, false)).toBe("unstated");
  });

  it("lets archived and handling-flagged outrank the addressee", () => {
    expect(scopeOf(quoted("Client Alpha"), true, false)).toBe("archived");
    expect(scopeOf(quoted("Client Alpha"), false, true)).toBe("human");
  });
});

describe("video posters", () => {
  it("keeps video playback available when a card poster exists", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-video-poster-"));
    temporaryVaults.push(vault);
    process.env["ROBIN_VAULT"] = vault;
    await fs.mkdir(path.join(vault, "out"));
    await fs.writeFile(path.join(vault, "out/demo.mp4"), "video fixture");
    await fs.writeFile(path.join(vault, "out/demo.poster.jpg"), "poster fixture");
    const ledger = await deriveLedger([{
      title: "Demo", path: "out/demo.mp4", kind: "video",
      href: "/api/file/out/demo.mp4", mtime: new Date(), size: 13,
    }], new Map());
    expect(ledger.items[0]?.preview).toEqual({
      kind: "video", src: "/api/file/out/demo.mp4", poster: "/api/file/out/demo.poster.jpg",
    });
  });
});

describe("archive directory classification", () => {
  it("matches archive lifecycle directory names as whole path segments", () => {
    expect(isArchivedPath("out/archive/old.html")).toBe(true);
    expect(isArchivedPath("out/archives/old.html")).toBe(true);
    expect(isArchivedPath("out/archived/old.html")).toBe(true);
    expect(isArchivedPath("out/archive-notes/current.html")).toBe(false);
  });

  it("deriveLedger puts an unmarked file under an archive directory in the archived group", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-outputs-archive-"));
    temporaryVaults.push(vault);
    process.env["ROBIN_VAULT"] = vault;
    const relPath = "out/archives/old-deck.html";
    const absolutePath = path.join(vault, relPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, doc("<h1>Old deck</h1>"));

    const item: OutputItem = {
      title: "old deck",
      path: relPath,
      kind: "html",
      href: "/file/out/archives/old-deck.html",
      mtime: new Date("2026-09-09T08:00:00Z"),
      size: 42,
    };
    const ledger = await deriveLedger([item], new Map());

    expect(ledger.items[0]?.state).toBe("UNSTATED");
    expect(ledger.items[0]?.scope).toBe("archived");
    expect(ledger.groups).toEqual([
      expect.objectContaining({ scope: "archived", entries: [{ kind: "row", path: relPath }] }),
    ]);
  });

  it("moves annotation tallies to the current output and leaves true orphans counted", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-outputs-annotations-"));
    temporaryVaults.push(vault);
    process.env.ROBIN_VAULT = vault;
    const currentPath = "out/archive/current.html";
    const absolutePath = path.join(vault, currentPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, doc("<h1>Current deck</h1>"));

    const annotationDir = path.join(vault, "inbox/robin/annotations");
    await fs.mkdir(annotationDir, { recursive: true });
    await fs.writeFile(
      path.join(annotationDir, "2026-09.jsonl"),
      [
        JSON.stringify({ id: "follows-move", page_path: "out/old.html" }),
        JSON.stringify({ id: "true-orphan", page_path: "out/missing.html" }),
      ].join("\n"),
    );
    const editDir = path.join(vault, "inbox/robin/edits");
    await fs.mkdir(editDir, { recursive: true });
    await fs.writeFile(
      path.join(editDir, "2026-09.jsonl"),
      JSON.stringify({
        id: "move-1",
        event: "edit.moved",
        previous_path: "out/old.html",
        page_path: currentPath,
        ts: "2026-09-09T08:00:00Z",
      }),
    );

    const item: OutputItem = {
      title: "current deck",
      path: currentPath,
      kind: "html",
      href: "/out/archive/current",
      mtime: new Date("2026-09-09T08:00:00Z"),
      size: 42,
    };
    const ledger = await deriveLedger([item], new Map());

    expect(ledger.items[0]?.comments).toBe(1);
    expect(ledger.orphanAnnotations).toBe(1);
  });

  it("never batches an archived artifact with current files touched in the same minute", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-outputs-mixed-series-"));
    temporaryVaults.push(vault);
    process.env.ROBIN_VAULT = vault;
    const mtime = new Date("2026-09-09T08:00:00Z");
    const fixtures = [
      { path: "out/briefs/office.html", body: "<h1>Office brief</h1>" },
      {
        path: "out/briefs/client-delta.html",
        body: "<p>Prepared for Client Delta</p><h1>Client Delta brief</h1>",
      },
      {
        path: "out/briefs/questionnaire.html",
        body: "<h1>Questionnaire</h1>",
        head: '<meta name="robin:status" content="archived">',
      },
    ];
    const outputs: OutputItem[] = [];
    for (const fixture of fixtures) {
      const absolutePath = path.join(vault, fixture.path);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, doc(fixture.body, fixture.head ?? ""));
      outputs.push({
        title: path.basename(fixture.path, ".html"),
        path: fixture.path,
        kind: "html",
        href: `/${fixture.path.replace(/\.html$/, "")}`,
        mtime,
        size: 42,
      });
    }

    const ledger = await deriveLedger(outputs, new Map());

    expect(ledger.series.flatMap((series) => series.members)).not.toContain(
      "out/briefs/questionnaire.html",
    );
    expect(ledger.items.find((item) => item.path.endsWith("questionnaire.html"))?.scope).toBe(
      "archived",
    );
    expect(ledger.groups.find((group) => group.scope === "archived")?.entries).toEqual([
      { kind: "row", path: "out/briefs/questionnaire.html" },
    ]);
    expect(ledger.groups.find((group) => group.scope === "outside")?.entries).not.toContainEqual({
      kind: "row",
      path: "out/briefs/questionnaire.html",
    });
  });

  it("does not batch same-minute artifacts from different recipient scopes", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-outputs-mixed-scopes-"));
    temporaryVaults.push(vault);
    process.env.ROBIN_VAULT = vault;
    const mtime = new Date("2026-09-09T09:00:00Z");
    const fixtures = [
      { name: "client-alpha", recipient: "Client Alpha" },
      { name: "board", recipient: "Board &amp; Finance" },
      { name: "team", recipient: "Editorial" },
    ];
    const outputs: OutputItem[] = [];
    for (const fixture of fixtures) {
      const relPath = `out/briefs/${fixture.name}.html`;
      const absolutePath = path.join(vault, relPath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(
        absolutePath,
        doc(`<p>Prepared for ${fixture.recipient}</p><h1>${fixture.name} brief</h1>`),
      );
      outputs.push({
        title: fixture.name,
        path: relPath,
        kind: "html",
        href: `/out/briefs/${fixture.name}`,
        mtime,
        size: 42,
      });
    }

    const ledger = await deriveLedger(outputs, new Map());

    expect(ledger.series).toEqual([]);
    expect(Object.fromEntries(ledger.items.map((item) => [item.path, item.scope]))).toEqual({
      "out/briefs/client-alpha.html": "outside",
      "out/briefs/board.html": "board",
      "out/briefs/team.html": "team",
    });
  });
});

describe("inferredSubject", () => {
  it("reads a person-shaped subject off a dashboard title", () => {
    expect(inferredSubject("Jordan Lee — AI logic & the enrichment pipe")).toBe("Jordan");
  });

  it("refuses initialisms and titles with no subject clause", () => {
    expect(inferredSubject("DEMO — Credit Phonetics")).toBeUndefined();
    expect(inferredSubject("Example Automation")).toBeUndefined();
  });
});

describe("seriesOf", () => {
  const at = (iso: string) => new Date(iso);

  it("detects a generator batch: same directory, same mtime minute, ≥3 members", () => {
    const found = seriesOf([
      {
        path: "out/reports/alex.html",
        dir: "out/reports",
        ext: "html",
        mtime: at("2026-07-10T19:09:04Z"),
      },
      {
        path: "out/reports/jordan.html",
        dir: "out/reports",
        ext: "html",
        mtime: at("2026-07-10T19:09:31Z"),
      },
      {
        path: "out/reports/casey.html",
        dir: "out/reports",
        ext: "html",
        mtime: at("2026-07-10T19:09:58Z"),
      },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.id.startsWith("batch:")).toBe(true);
    expect(found[0]?.note).toContain("3 files");
    expect(found[0]?.members).toHaveLength(3);
  });

  it("never manufactures a series out of the archive bulk-touch", () => {
    expect(
      seriesOf([
        {
          path: "out/archive/a.html",
          dir: "out/archive",
          ext: "html",
          mtime: at("2026-07-01T09:00:10Z"),
        },
        {
          path: "out/archive/b.html",
          dir: "out/archive",
          ext: "html",
          mtime: at("2026-07-01T09:00:20Z"),
        },
        {
          path: "out/archive/c.html",
          dir: "out/archive",
          ext: "html",
          mtime: at("2026-07-01T09:00:30Z"),
        },
      ]),
    ).toEqual([]);
  });

  it("detects sibling cuts and states that disk cannot say which one shipped", () => {
    const found = seriesOf([
      {
        path: "out/robin-launch-video/v5.mp4",
        dir: "out/robin-launch-video",
        ext: "mp4",
        mtime: at("2026-05-30T10:00:00Z"),
      },
      {
        path: "out/robin-launch-video/alt1.mp4",
        dir: "out/robin-launch-video",
        ext: "mp4",
        mtime: at("2026-05-30T11:22:00Z"),
      },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe("cuts:out/robin-launch-video");
    expect(found[0]?.caveat).toBe("Nothing on disk records which cut shipped.");
  });

  it("is not a series when the two files are just different formats of one thing", () => {
    expect(
      seriesOf([
        {
          path: "out/presentations/c.html",
          dir: "out/presentations",
          ext: "html",
          mtime: at("2026-07-15T08:00:00Z"),
        },
        {
          path: "out/presentations/c.pptx",
          dir: "out/presentations",
          ext: "pptx",
          mtime: at("2026-07-15T09:30:00Z"),
        },
      ]),
    ).toEqual([]);
  });

  it("leaves out/ itself alone — the root is not a deliverable", () => {
    expect(
      seriesOf([
        { path: "out/a.html", dir: "out", ext: "html", mtime: at("2026-07-15T08:00:00Z") },
        { path: "out/b.html", dir: "out", ext: "html", mtime: at("2026-07-15T09:30:00Z") },
      ]),
    ).toEqual([]);
  });
});

describe("censusOf", () => {
  const view = (over: Partial<OutputView>): OutputView =>
    ({
      path: over.path ?? "out/x.html",
      recipient: { text: "", grade: "none" },
      state: "UNSTATED",
      scope: "unstated",
      flags: [],
      ...over,
    }) as OutputView;

  it("counts from the same view models that filled the rows", () => {
    const entries = censusOf([
      view({
        path: "a",
        recipient: { text: "Client Alpha", grade: "quoted" },
        state: "STABLE",
        scope: "outside",
      }),
      view({
        path: "b",
        recipient: { text: "Board", grade: "quoted" },
        state: "DRAFT",
        scope: "board",
      }),
      view({ path: "c" }),
      view({ path: "d", scope: "archived", state: "ARCHIVED" }),
      view({
        path: "e",
        flags: [{ key: "h", glyph: "◈", label: "do not send", title: "t" }],
        edit: { saves: 9, actor: "deck-editor", dateLabel: "20 Jul" },
      }),
    ]);
    const by = Object.fromEntries(entries.map((e) => [e.key, e.count]));
    expect(by["all"]).toBe(5);
    expect(by["addressed"]).toBe(2);
    expect(by["unstated-recipient"]).toBe(3);
    expect(by["stable"]).toBe(1);
    expect(by["draft"]).toBe(1);
    expect(by["archived"]).toBe(1);
    expect(by["handling-flagged"]).toBe(1);
    expect(by["with-edit-history"]).toBe(1);
  });

  it('keeps "all" but drops counters that would print a zero', () => {
    const entries = censusOf([view({ path: "a" })]);
    expect(entries.map((e) => e.key)).toEqual(["all", "unstated-recipient"]);
  });
});
