import { describe, expect, it } from "vitest";
import { frontmatterFromMeta, metaTagsForHead, normalizeFrontmatter } from "../src/meta.js";
import { executablePageRoots, isExecutablePagePath } from "../src/migration-scope.js";
import { migrateV02ToV03 } from "../src/migrations/v0.2-to-v0.3.js";
import { parseRobinHtmlCore } from "../src/parse.js";

const TEST_ID = "123e4567-e89b-52d3-a456-426614174000";

function page(sources: string[] = []): string {
  const sourceTags = sources
    .map((source) => `  <meta name="robin:source" content="${source}">`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Stable identity</title>
  <meta name="robin:path" content="brain/projects/stable.html">
  <meta name="robin:slug" content="stable">
  <meta name="robin:type" content="knowledge">
  <meta name="robin:updated" content="2026-07-25T00:00:00Z">
  <meta name="robin:version" content="0.2">
${sourceTags ? `${sourceTags}\n` : ""}</head>
<body>
  <article data-robin-doc>
    <h1>Stable identity</h1>
    <p>Body bytes must stay exactly as authored.</p>
  </article>
</body>
</html>
`;
}

describe("v0.2 → v0.3 migration", () => {
  it("derives migration scope from the executable contract roots", () => {
    const roots = executablePageRoots({
      page: {
        roots: [{ path: "brain" }, { path: "logs" }, { path: "out" }],
      },
    });

    expect(roots).toEqual(["brain", "logs", "out"]);
    expect(isExecutablePagePath("brain/projects/stable.html", roots)).toBe(true);
    expect(isExecutablePagePath("inbox/archived/stable.html", roots)).toBe(false);
    expect(() =>
      executablePageRoots({
        page: { roots: [{ path: "../brain" }] },
      }),
    ).toThrow(/top-level relative paths/);
  });

  it("adds a globally unique UUID and losslessly types legacy provenance", () => {
    const input = page(["logs/meetings/2026-07-25-sync.html", "manual"]);
    const result = migrateV02ToV03(input);
    const parsed = parseRobinHtmlCore(result.html);

    expect(result.changed).toBe(true);
    expect(parsed.metaMap["robin:version"]).toEqual(["0.3"]);
    expect(parsed.metaMap["robin:id"]).toHaveLength(1);
    expect(parsed.metaMap["robin:id"]?.[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(parsed.metaMap["robin:source"]).toBeUndefined();
    expect(parsed.metaMap["robin:source-kind"]).toEqual(["meeting", "manual"]);
    expect(parsed.metaMap["robin:source-ref"]).toEqual([
      "logs/meetings/2026-07-25-sync.html",
      "urn:robin:legacy-source:manual",
    ]);
  });

  it("classifies bare Slack and ingest provenance without losing intent", () => {
    const parsed = parseRobinHtmlCore(migrateV02ToV03(page(["slack", "ingest"])).html);

    expect(parsed.metaMap["robin:source-kind"]).toEqual(["import", "slack"]);
    expect(parsed.metaMap["robin:source-ref"]).toEqual([
      "urn:robin:legacy-source:ingest",
      "urn:robin:legacy-source:slack",
    ]);
  });

  it("preserves the article section byte-for-byte and is idempotent", () => {
    const input = page(["https://example.com/evidence"]);
    const once = migrateV02ToV03(input);
    const twice = migrateV02ToV03(once.html);
    const article = (html: string) =>
      html.slice(html.indexOf("<article"), html.indexOf("</article>") + 10);

    expect(article(once.html)).toBe(article(input));
    expect(twice).toEqual({ html: once.html, changed: false });
  });

  it("does not collide when independent vaults migrate the same relative path", () => {
    const first = parseRobinHtmlCore(migrateV02ToV03(page()).html).metaMap["robin:id"]?.[0];
    const second = parseRobinHtmlCore(migrateV02ToV03(page()).html).metaMap["robin:id"]?.[0];
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
  });

  it("requires clean v0.2 input without pre-seeded v0.3 fields", () => {
    expect(() => migrateV02ToV03(page().replace('content="0.2"', 'content="0.1"'))).toThrow(
      /requires a v0\.2 document/,
    );
    expect(() =>
      migrateV02ToV03(
        page().replace("</head>", '  <meta name="robin:source-kind" content="web">\n</head>'),
      ),
    ).toThrow(/cannot contain pre-seeded typed provenance/);
    expect(() =>
      migrateV02ToV03(
        page().replace(
          "</head>",
          '  <meta name="robin:id" content="123e4567-e89b-42d3-a456-426614174000">\n</head>',
        ),
      ),
    ).toThrow(/cannot contain a pre-seeded robin:id/);
  });

  it("refuses generic HTML before assigning an immutable identity", () => {
    expect(() => migrateV02ToV03(page().replace(" data-robin-doc", ""))).toThrow(
      /requires exactly one <article data-robin-doc>; found 0/,
    );
  });

  it("rewrites valid single-quoted, content-before-name metadata structurally", () => {
    const input = page()
      .replace(
        '<meta name="robin:version" content="0.2">',
        "<meta content='0.2' name='robin:version'>",
      )
      .replace(
        '<meta name="robin:path" content="brain/projects/stable.html">',
        "<meta content='brain/projects/stable.html' name='robin:path'>",
      );
    const result = migrateV02ToV03(input, {
      vaultRelativePath: "brain/projects/stable.html",
    });
    const parsed = parseRobinHtmlCore(result.html);

    expect(parsed.metaMap["robin:version"]).toEqual(["0.3"]);
    expect(parsed.metaMap["robin:id"]?.[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("uses the actual file path as identity authority and rejects path drift", () => {
    expect(() =>
      migrateV02ToV03(page(), {
        vaultRelativePath: "brain/projects/renamed.html",
      }),
    ).toThrow(/robin:path mismatch/);
  });

  it("rewrites an equivalent but noncanonical stored path", () => {
    const input = page().replace(
      'content="brain/projects/stable.html"',
      'content="brain//projects/stable.html"',
    );
    const parsed = parseRobinHtmlCore(
      migrateV02ToV03(input, {
        vaultRelativePath: "brain/projects/stable.html",
      }).html,
    );

    expect(parsed.metaMap["robin:path"]).toEqual(["brain/projects/stable.html"]);
  });

  it("validates already-v0.3 input instead of blessing malformed identity", () => {
    const malformed = page().replace('content="0.2"', 'content="0.3"');
    expect(() => migrateV02ToV03(malformed)).toThrow(/valid robin:id UUID/);
  });

  it("refuses ambiguous scalar identity metadata instead of collapsing it", () => {
    const duplicate = (name: string, value: string) =>
      page().replace("</head>", `  <meta name="${name}" content="${value}">\n</head>`);

    expect(() => migrateV02ToV03(duplicate("robin:version", "0.2"))).toThrow(
      /duplicate robin:version/,
    );
    expect(() => migrateV02ToV03(duplicate("robin:path", "brain/projects/other.html"))).toThrow(
      /duplicate robin:path/,
    );
    expect(() =>
      migrateV02ToV03(
        duplicate("robin:id", "123e4567-e89b-52d3-a456-426614174000").replace(
          "</head>",
          '  <meta name="robin:id" content="123e4567-e89b-52d3-a456-426614174001">\n</head>',
        ),
      ),
    ).toThrow(/duplicate robin:id/);
  });

  it("ignores metadata-looking tags outside the real head", () => {
    const input = page().replace(
      "<h1>Stable identity</h1>",
      '<h1>Stable identity</h1><meta name="robin:version" content="0.3">' +
        '<meta name="robin:id" content="00000000-0000-5000-8000-000000000000">',
    );
    const result = migrateV02ToV03(input);
    const parsed = parseRobinHtmlCore(result.html);

    expect(parsed.metaMap["robin:version"]).toEqual(["0.3"]);
    expect(parsed.metaMap["robin:id"]?.[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("does not emit v0.3-only fields from a v0.2 producer", () => {
    expect(() =>
      normalizeFrontmatter({
        frontmatter: {
          version: "0.2",
          id: TEST_ID,
          source_kinds: ["web"],
          source_refs: ["https://example.com"],
        },
        slug: "stable",
        outputPath: "brain/projects/stable.html",
        title: "Stable",
      }),
    ).toThrow(/require frontmatter\.version 0\.3/);
  });

  it("rejects unknown producer versions instead of silently downgrading them", () => {
    expect(() =>
      normalizeFrontmatter({
        frontmatter: {
          version: "0.4",
        },
        slug: "stable",
        outputPath: "brain/projects/stable.html",
        title: "Stable",
      }),
    ).toThrow(/Unsupported Robin producer version: 0\.4/);
  });

  it("rejects legacy provenance in a v0.3 producer instead of dropping it", () => {
    const base = {
      version: "0.3",
      id: TEST_ID,
      type: "knowledge",
    };
    for (const frontmatter of [
      { ...base, sources: ["legacy-evidence"] },
      {
        ...base,
        sources: ["legacy-evidence"],
        source_kinds: ["web"],
        source_refs: ["https://example.com/evidence"],
      },
    ]) {
      expect(() =>
        normalizeFrontmatter({
          frontmatter,
          slug: "stable",
          outputPath: "brain/projects/stable.html",
          title: "Stable",
        }),
      ).toThrow(/cannot use legacy frontmatter\.source\/sources/);
    }
  });

  it("canonicalizes a producer-supplied v0.3 UUID to lowercase", () => {
    const id = TEST_ID;
    const { meta } = normalizeFrontmatter({
      frontmatter: {
        version: "0.3",
        id: id.toUpperCase(),
        type: "knowledge",
      },
      slug: "stable",
      outputPath: "brain/projects/stable.html",
      title: "Stable",
    });

    expect(meta.id).toBe(id);
    expect(metaTagsForHead(meta)).toContainEqual(["robin:id", id]);
  });

  it("keeps typed source pairs aligned through canonical write projection", () => {
    const id = TEST_ID;
    const { meta } = normalizeFrontmatter({
      frontmatter: {
        version: "0.3",
        id,
        type: "knowledge",
        source_kinds: ["web", "document"],
        source_refs: ["https://example.com/z", "inbox/a.pdf"],
      },
      slug: "stable",
      outputPath: "brain/projects/stable.html",
      title: "Stable",
      updated: new Date("2026-07-25T00:00:00Z"),
    });
    const sourceTags = metaTagsForHead(meta).filter(([name]) => name.startsWith("robin:source-"));

    expect(sourceTags).toEqual([
      ["robin:source-kind", "web"],
      ["robin:source-ref", "https://example.com/z"],
      ["robin:source-kind", "document"],
      ["robin:source-ref", "inbox/a.pdf"],
    ]);
    expect(frontmatterFromMeta(meta)).toMatchObject({
      version: "0.3",
      id,
      source_kinds: ["web", "document"],
      source_refs: ["https://example.com/z", "inbox/a.pdf"],
    });
  });
});
