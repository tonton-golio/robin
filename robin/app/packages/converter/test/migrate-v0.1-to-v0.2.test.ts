import { describe, expect, it } from "vitest";
import { migrateV01ToV02 } from "../src/migrations/v0.1-to-v0.2.js";

const V01_FIXTURE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test Page</title>
  <link rel="canonical" href="/p/test-page">
  <meta name="robin:version" content="0.1">
  <meta name="robin:slug" content="test-page">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-05-26T00:00:00Z">
  <meta name="robin:tag" content="alpha">
  <meta name="robin:tag" content="beta">
  <script type="application/json" id="robin:frontmatter">{
  "title": "Test Page",
  "type": "note"
}</script>
  <script type="application/json" id="robin:blocks">[
  {"kind": "heading", "level": 1, "content": [{"kind": "text", "text": "Test Page"}]},
  {"kind": "paragraph", "content": [{"kind": "text", "text": "Hello [[other-page|world]]."}]}
]</script>
</head>
<body>
  <article data-robin-doc>
    <h1>Test Page</h1>
    <p>Hello <a data-wiki="other-page" href="/p/other-page">world</a>.</p>
  </article>
</body>
</html>`;

const V02_EXPECTED = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test Page</title>
  <link rel="canonical" href="/p/test-page">
  <meta name="robin:version" content="0.2">
  <meta name="robin:slug" content="test-page">
  <meta name="robin:type" content="note">
  <meta name="robin:updated" content="2026-05-26T00:00:00Z">
  <meta name="robin:tag" content="alpha">
  <meta name="robin:tag" content="beta">
</head>
<body>
  <article data-robin-doc>
    <h1>Test Page</h1>
    <p>Hello <a data-wiki="other-page" href="/p/other-page">world</a>.</p>
  </article>
</body>
</html>`;

describe("migrateV01ToV02", () => {
  it("strips both robin:frontmatter and robin:blocks script tags", () => {
    const { html, changed } = migrateV01ToV02(V01_FIXTURE);
    expect(changed).toBe(true);
    expect(html).not.toContain('id="robin:frontmatter"');
    expect(html).not.toContain('id="robin:blocks"');
    expect(html).not.toContain("<script");
  });

  it("bumps robin:version from 0.1 to 0.2", () => {
    const { html } = migrateV01ToV02(V01_FIXTURE);
    expect(html).toContain('<meta name="robin:version" content="0.2">');
    expect(html).not.toContain('<meta name="robin:version" content="0.1">');
  });

  it("preserves the article body exactly", () => {
    const { html } = migrateV01ToV02(V01_FIXTURE);
    const articleStart = html.indexOf("<article");
    const articleEnd = html.indexOf("</article>") + "</article>".length;
    const article = html.slice(articleStart, articleEnd);
    expect(article).toContain("<h1>Test Page</h1>");
    expect(article).toContain('data-wiki="other-page"');
    expect(article).toContain("Hello");
  });

  it("produces the expected v0.2 fixture byte-for-byte", () => {
    const { html } = migrateV01ToV02(V01_FIXTURE);
    expect(html).toBe(V02_EXPECTED);
  });

  it("is idempotent on a v0.2 file", () => {
    const { html: once, changed: changedOnce } = migrateV01ToV02(V01_FIXTURE);
    expect(changedOnce).toBe(true);
    const { html: twice, changed: changedTwice } = migrateV01ToV02(once);
    expect(changedTwice).toBe(false);
    expect(twice).toBe(once);
  });

  it("is idempotent on the expected v0.2 fixture directly", () => {
    const { html, changed } = migrateV01ToV02(V02_EXPECTED);
    expect(changed).toBe(false);
    expect(html).toBe(V02_EXPECTED);
  });

  it("refuses to downgrade newer document versions", () => {
    const v03 = V02_EXPECTED.replace('content="0.2"', 'content="0.3"');
    const future = V02_EXPECTED.replace('content="0.2"', 'content="0.4"');

    expect(() => migrateV01ToV02(v03)).toThrow(/refuses to downgrade document version 0\.3/);
    expect(() => migrateV01ToV02(future)).toThrow(/refuses to downgrade document version 0\.4/);
  });

  it("inserts robin:version when missing", () => {
    const noVersion = V01_FIXTURE.replace(/\s*<meta name="robin:version" content="0\.1">/, "");
    const { html } = migrateV01ToV02(noVersion);
    expect(html).toContain('<meta name="robin:version" content="0.2">');
  });

  it("adds and verifies robin:path when the authoritative vault path is supplied", () => {
    const { html } = migrateV01ToV02(V01_FIXTURE, {
      vaultRelativePath: "brain/test-page.html",
    });
    expect(html).toContain('<meta name="robin:path" content="brain/test-page.html">');

    const drifted = V01_FIXTURE.replace(
      "</head>",
      '  <meta name="robin:path" content="brain/old.html">\n</head>',
    );
    expect(() =>
      migrateV01ToV02(drifted, {
        vaultRelativePath: "brain/test-page.html",
      }),
    ).toThrow(/robin:path mismatch/);

    const equivalentButNoncanonical = V01_FIXTURE.replace(
      "</head>",
      '  <meta name="robin:path" content="brain//test-page.html">\n</head>',
    );
    const canonical = migrateV01ToV02(equivalentButNoncanonical, {
      vaultRelativePath: "brain/test-page.html",
    });
    expect(canonical.html).toContain('<meta name="robin:path" content="brain/test-page.html">');
  });

  it("preserves all non-version robin:* meta tags untouched", () => {
    const { html } = migrateV01ToV02(V01_FIXTURE);
    expect(html).toContain('<meta name="robin:slug" content="test-page">');
    expect(html).toContain('<meta name="robin:type" content="note">');
    expect(html).toContain('<meta name="robin:tag" content="alpha">');
    expect(html).toContain('<meta name="robin:tag" content="beta">');
    expect(html).toContain('<meta name="robin:updated" content="2026-05-26T00:00:00Z">');
  });

  it('preserves the <link rel="canonical"> tag', () => {
    const { html } = migrateV01ToV02(V01_FIXTURE);
    expect(html).toContain('<link rel="canonical" href="/p/test-page">');
  });

  it("refuses to bless generic or structurally ambiguous HTML", () => {
    const generic = V01_FIXTURE.replace(" data-robin-doc", "");
    const duplicate = V01_FIXTURE.replace(
      "</body>",
      "  <article data-robin-doc><p>Second body</p></article>\n</body>",
    );

    expect(() => migrateV01ToV02(generic)).toThrow(
      /requires exactly one <article data-robin-doc>; found 0/,
    );
    expect(() => migrateV01ToV02(duplicate)).toThrow(
      /requires exactly one <article data-robin-doc>; found 2/,
    );
  });

  it("requires the minimum canonical metadata before migration", () => {
    const missingType = V01_FIXTURE.replace(/\s*<meta name="robin:type" content="note">/, "");
    expect(() => migrateV01ToV02(missingType)).toThrow(/requires exactly one non-empty robin:type/);
  });

  it("handles quote and attribute-order variants structurally", () => {
    const variant = V01_FIXTURE.replace(
      '<meta name="robin:version" content="0.1">',
      "<meta content='0.1' name='robin:version'>",
    )
      .replace(
        '<script type="application/json" id="robin:frontmatter">',
        "<script id='robin:frontmatter' type='application/json'>",
      )
      .replace(
        '<script type="application/json" id="robin:blocks">',
        "<script id='robin:blocks' type='application/json'>",
      );
    const { html } = migrateV01ToV02(variant);

    expect(html).toContain('<meta name="robin:version" content="0.2">');
    expect(html.match(/name="robin:version"/g)).toHaveLength(1);
    expect(html).not.toContain("robin:frontmatter");
    expect(html).not.toContain("robin:blocks");
  });

  it("does not normalize unrelated whitespace inside the document head", () => {
    const unrelatedScript = [
      "  <script>",
      "const template = `line one",
      "",
      "line three`;",
      "  </script>",
    ].join("\n");
    const input = V01_FIXTURE.replace(
      '  <script type="application/json" id="robin:frontmatter">',
      `${unrelatedScript}\n  <script type="application/json" id="robin:frontmatter">`,
    );
    const { html } = migrateV01ToV02(input);

    expect(html).toContain(unrelatedScript);
  });

  it("requires exactly one non-empty title in the real document head", () => {
    const bodyTitleOnly = V01_FIXTURE.replace("<title>Test Page</title>", "").replace(
      "<h1>Test Page</h1>",
      "<svg><title>Body tooltip</title></svg><h1>Test Page</h1>",
    );
    const duplicateHeadTitle = V01_FIXTURE.replace(
      "</head>",
      "  <title>Second title</title>\n</head>",
    );

    expect(() => migrateV01ToV02(bodyTitleOnly)).toThrow(/exactly one non-empty <title> in <head>/);
    expect(() => migrateV01ToV02(duplicateHeadTitle)).toThrow(
      /exactly one non-empty <title> in <head>/,
    );
  });

  it("rejects duplicate version and legacy payload metadata", () => {
    const duplicateVersion = V01_FIXTURE.replace(
      "</head>",
      '  <meta name="robin:version" content="0.1">\n</head>',
    );
    const duplicatePayload = V01_FIXTURE.replace(
      "</head>",
      "  <script id='robin:blocks' type='application/json'>[]</script>\n</head>",
    );

    expect(() => migrateV01ToV02(duplicateVersion)).toThrow(/refuses duplicate robin:version/);
    expect(() => migrateV01ToV02(duplicatePayload)).toThrow(/duplicate_script_tag: robin:blocks/);
  });
});
