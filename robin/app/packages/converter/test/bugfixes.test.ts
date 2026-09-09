import { describe, expect, it } from "vitest";
import { blocksToBodyHtml } from "../src/blocks-to-html.js";
import { canonicalizeHtml, convertMarkdown, normalizeDate } from "../src/index.js";
import { extractMetaFromMap, parseRobinHtmlCore } from "../src/parse.js";
import type { RobinBlock, RobinMeta } from "../src/types.js";

/**
 * Regression suite for the converter hardening pass (deep-QA findings).
 * Each block locks a previously-confirmed bug so it can't silently regress.
 */

describe("wikilink embed discriminator (embed flag, not alias sentinel)", () => {
  it('a normal wikilink whose alias is literally "embed" stays a link', () => {
    // Bug: alias==='embed' was overloaded as the embed sentinel, so
    // [[some-page|embed]] was misrendered as an empty <figure> image.
    const { html, blocks } = convertMarkdown("[[some-page|embed]]", {
      outputPath: "brain/w.html",
    });
    expect(html).not.toContain('data-embed="image"');
    expect(html).toContain('data-wiki="some-page"');
    expect(html).toContain(">embed</a>");
    expect(blocks.some((b) => b.kind === "embeddedImage")).toBe(false);
    const wikilinkBlock = blocks.find((b) => b.kind === "paragraph");
    expect(wikilinkBlock).toBeDefined();
  });

  it("a real ![[image.png]] embed still becomes an embeddedImage", () => {
    const { html, blocks } = convertMarkdown("![[diagram.png]]", {
      outputPath: "brain/e.html",
    });
    const embed = blocks.find((b) => b.kind === "embeddedImage");
    expect(embed).toBeDefined();
    expect(html).toContain('data-embed="image"');
    expect(html).toContain('data-wiki="diagram.png"');
  });
});

describe("embed caption → alt text (embed-caption-alias-dropped)", () => {
  it("carries the ![[image|caption]] alias through to img alt", () => {
    const { html, blocks } = convertMarkdown("![[diagram.png|My caption]]", {
      outputPath: "brain/cap.html",
    });
    const embed = blocks.find((b) => b.kind === "embeddedImage");
    expect(embed).toBeDefined();
    expect((embed as { alt?: string }).alt).toBe("My caption");
    expect(html).toContain('alt="My caption"');
    expect(html).toContain('data-wiki="diagram.png"');
  });

  it("embed without a caption renders an empty alt", () => {
    const { html } = convertMarkdown("![[diagram.png]]", { outputPath: "brain/nc.html" });
    expect(html).toContain('alt=""');
  });
});

describe("callout title with inline formatting (callout-title-inline-formatting-leak)", () => {
  it("keeps the whole title line (incl. bold) as the title, not in the body", () => {
    const md = `> [!note] Title with **bold** word
> body line`;
    const { blocks, html } = convertMarkdown(md, { outputPath: "brain/co.html" });
    const callout = blocks.find((b) => b.kind === "callout");
    expect(callout).toBeDefined();
    expect((callout as { title?: string }).title).toBe("Title with bold word");
    // Body must be only "body line" — no leaked title fragment.
    const bodyBlocks = (callout as { children: RobinBlock[] }).children;
    const bodyText = JSON.stringify(bodyBlocks);
    expect(bodyText).toContain("body line");
    expect(bodyText).not.toContain("word");
    expect(html).toContain('data-callout="note"');
  });

  it("flattens a wikilink/code title to plain text", () => {
    const md = `> [!warning] See [[other-page]] and \`foo()\` now`;
    const { blocks } = convertMarkdown(md, { outputPath: "brain/co2.html" });
    const callout = blocks.find((b) => b.kind === "callout");
    expect((callout as { title?: string }).title).toBe("See other-page and foo() now");
    // No fabricated body paragraph from the title remainder.
    expect((callout as { children: RobinBlock[] }).children.length).toBe(0);
  });

  it("plain-text title + body still works (no regression)", () => {
    const md = `> [!note] Important
> Body of the callout.`;
    const { blocks } = convertMarkdown(md, { outputPath: "brain/co3.html" });
    const callout = blocks.find((b) => b.kind === "callout") as {
      title?: string;
      children: RobinBlock[];
    };
    expect(callout.title).toBe("Important");
    expect(JSON.stringify(callout.children)).toContain("Body of the callout.");
  });
});

describe("normalizeDate timezone determinism (normalizedate-naive-datetime-local-tz)", () => {
  it("treats a zone-less datetime as UTC (not host-local)", () => {
    expect(normalizeDate("2026-05-26T10:30:00")).toBe("2026-05-26T10:30:00Z");
  });

  it("respects an explicit Z designator", () => {
    expect(normalizeDate("2026-05-26T10:30:00Z")).toBe("2026-05-26T10:30:00Z");
  });

  it("respects an explicit ±HH:MM offset", () => {
    // 10:30 at +02:00 is 08:30 UTC.
    expect(normalizeDate("2026-05-26T10:30:00+02:00")).toBe("2026-05-26T08:30:00Z");
  });

  it("naked date stays midnight UTC", () => {
    expect(normalizeDate("2026-05-26")).toBe("2026-05-26T00:00:00Z");
  });
});

describe("table ragged-row padding (table-ragged-rows-not-padded)", () => {
  it("pads a short body row to the header column count", () => {
    const blocks: RobinBlock[] = [
      {
        kind: "table",
        headers: [[{ kind: "text", text: "A" }], [{ kind: "text", text: "B" }]],
        rows: [[[{ kind: "text", text: "1" }]]], // only 1 cell vs 2 headers
      },
    ];
    const html = blocksToBodyHtml(blocks);
    expect(html).toContain("<tbody><tr><td>1</td><td></td></tr></tbody>");
  });

  it("drops overflow cells beyond the header count", () => {
    const blocks: RobinBlock[] = [
      {
        kind: "table",
        headers: [[{ kind: "text", text: "A" }]],
        rows: [[[{ kind: "text", text: "1" }], [{ kind: "text", text: "2" }]]],
      },
    ];
    const html = blocksToBodyHtml(blocks);
    expect(html).toContain("<tbody><tr><td>1</td></tr></tbody>");
  });
});

describe("meta content newline escaping (meta-content-newline-not-escaped)", () => {
  it("keeps a multi-line summary on one physical <meta> line", () => {
    const meta: RobinMeta = {
      version: "0.2",
      slug: "ml",
      path: "brain/ml.html",
      type: "note",
      updated: "2026-05-26T00:00:00Z",
      summary: "line one\nline two\twith tab",
      tags: [],
      attendees: [],
      sources: [],
      unknownKeys: [],
    };
    const html = canonicalizeHtml({
      meta,
      frontmatter: {},
      blocks: [],
      updatedAt: new Date("2026-05-26T00:00:00Z"),
    });
    const summaryLine = html.split("\n").find((l) => l.includes("robin:summary"));
    expect(summaryLine).toBeDefined();
    expect(summaryLine).toContain("&#10;");
    expect(summaryLine).toContain("&#9;");
    // The content attribute must not contain a raw newline (i.e. it's one line).
    expect(summaryLine).toContain("line one&#10;line two");
  });
});

describe("page title comes from <head>, not from an SVG tooltip", () => {
  it("the first <title> wins when the body contains inline-SVG titles", () => {
    // Bug: the head/body walk assigned `title` on EVERY <title> visit, so the
    // LAST one won. Inline SVG uses <title> for accessible names and chart
    // tooltips, which named several out/ artifacts after a bar in one of their
    // own charts — and the wrong name reached the web reader, the indexer and
    // the MCP page tools alike.
    const html = [
      "<!doctype html><html><head>",
      "<title>Jul 2026 — 117 PRs merged into example-project</title>",
      '<meta name="robin:type" content="note">',
      "</head><body>",
      "<article data-robin-doc><p>body</p>",
      '<svg viewBox="0 0 10 10"><title>93 merged</title><rect width="4" height="9"/></svg>',
      "</article></body></html>",
    ].join("");

    const parsed = parseRobinHtmlCore(html);
    expect(parsed.title).toBe("Jul 2026 — 117 PRs merged into example-project");
    expect(parsed.headTitle).toBe("Jul 2026 — 117 PRs merged into example-project");
    expect(parsed.headTitleCount).toBe(1);
    expect(parsed.title).not.toBe("93 merged");
  });

  it("keeps an SVG-only display title separate from authoritative head title", () => {
    const html =
      "<!doctype html><html><head></head><body><svg><title>only one</title></svg></body></html>";
    const parsed = parseRobinHtmlCore(html);
    expect(parsed.title).toBe("only one");
    expect(parsed.headTitle).toBe("");
    expect(parsed.headTitleCount).toBe(0);
  });
});

describe("only head metadata is authoritative", () => {
  it("ignores body metadata examples and comments", () => {
    const html =
      "<!doctype html><html><head>" +
      '<meta name="robin:version" content="0.2"></head><body>' +
      '<!-- <meta name="robin:version" content="9.9"> -->' +
      '<article data-robin-doc><meta name="robin:version" content="0.3"></article>' +
      "</body></html>";
    expect(parseRobinHtmlCore(html).metaMap["robin:version"]).toEqual(["0.2"]);
  });
});

describe("comma-list robin:tags is read, not silently dropped", () => {
  const parse = (meta: string): string[] =>
    extractMetaFromMap(
      Object.fromEntries(
        [...meta.matchAll(/name="([^"]+)" content="([^"]*)"/g)].reduce((acc, m) => {
          const key = m[1] as string;
          (acc.get(key) ?? acc.set(key, []).get(key))?.push(m[2] as string);
          return acc;
        }, new Map<string, string[]>()),
      ),
      "out/x.html",
    ).tags;

  it("splits and trims a comma list when no canonical robin:tag exists", () => {
    // Four vault pages stamp the plural form; before this they had no tags at
    // all in the web app, the indexer or MCP.
    expect(parse('name="robin:tags" content="budget, spending ,finance"')).toEqual([
      "budget",
      "spending",
      "finance",
    ]);
  });

  it("canonical robin:tag wins and is never merged with the plural form", () => {
    expect(
      parse('name="robin:tag" content="alpha" name="robin:tags" content="beta,gamma"'),
    ).toEqual(["alpha"]);
  });

  it('no tag meta at all is an empty list, not [""]', () => {
    expect(parse('name="robin:type" content="note"')).toEqual([]);
  });
});
