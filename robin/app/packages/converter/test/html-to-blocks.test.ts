import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertMarkdown, blocksToBodyHtml } from '../src/index.js';
import { htmlBodyToBlocks } from '../src/html-to-blocks.js';
import type { RobinBlock, RobinTaskItem } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goldenDir = path.join(__dirname, 'golden');
const updated = new Date('2026-05-26T00:00:00Z');

function bodyFromMarkdown(md: string, name: string): string {
  const r = convertMarkdown(md, { outputPath: `brain/${name}.html`, updated });
  return blocksToBodyHtml(r.blocks);
}

function listGolden(): string[] {
  if (!fs.existsSync(goldenDir)) return [];
  return fs.readdirSync(goldenDir).filter((f) => f.endsWith('.md')).sort();
}

/**
 * The core guarantee: for every canonical body, parsing it back to blocks and
 * re-serializing reproduces the SAME body byte-for-byte. (html{raw} blocks, if
 * any, converge on the 2nd pass — not present in these clean markdown goldens.)
 */
describe('htmlToBlocks ⇄ blocksToBodyHtml round-trip (golden bodies)', () => {
  for (const file of listGolden()) {
    const name = file.replace(/\.md$/, '');
    it(`${name}: blocks → html → blocks → html is stable`, () => {
      const md = fs.readFileSync(path.join(goldenDir, file), 'utf8');
      const body = bodyFromMarkdown(md, name);
      const reparsed = htmlBodyToBlocks(body);
      expect(blocksToBodyHtml(reparsed)).toBe(body);
    });
  }
});

describe('htmlToBlocks — structural correctness on the nasty cases', () => {
  it('mixed task list: true / false / null discrimination', () => {
    const md = '- [ ] a\n- [x] b\n- plain\n';
    const body = bodyFromMarkdown(md, 'm');
    const [list] = htmlBodyToBlocks(body) as [RobinBlock];
    expect(list.kind).toBe('taskList');
    const items = (list as Extract<RobinBlock, { kind: 'taskList' }>).items as RobinTaskItem[];
    expect(items.map((i) => i.checked)).toEqual([false, true, null]);
  });

  it('bold-wrapping-a-wikilink keeps marks on the wikilink (outside the anchor)', () => {
    const body = bodyFromMarkdown('**[[some-page]]**', 'w');
    const [para] = htmlBodyToBlocks(body) as [RobinBlock];
    const inline = (para as Extract<RobinBlock, { kind: 'paragraph' }>).content[0]!;
    expect(inline.kind).toBe('wikilink');
    expect(inline.kind === 'wikilink' && inline.slug).toBe('some-page');
    expect(inline.kind === 'wikilink' && inline.marks).toEqual(['bold']);
  });

  it('embeddedImage vs image: discriminates on data-wiki', () => {
    const embed = htmlBodyToBlocks(
      '<figure data-embed="image"><img alt="cap" data-wiki="diagram.png" src=""></figure>',
    )[0]!;
    expect(embed.kind).toBe('embeddedImage');
    expect(embed.kind === 'embeddedImage' && embed.slug).toBe('diagram.png');

    const img = htmlBodyToBlocks(
      '<figure data-embed="image"><img alt="x" src="y.png"></figure>',
    )[0]!;
    expect(img.kind).toBe('image');
    expect(img.kind === 'image' && img.src).toBe('y.png');
  });

  it('hubChildren keeps only its query, ignoring any injected children', () => {
    const block = htmlBodyToBlocks(
      '<ul data-block="hubChildren" data-query="type:task"><li>injected</li></ul>',
    )[0]!;
    expect(block.kind).toBe('hubChildren');
    expect(block.kind === 'hubChildren' && block.query).toBe('type:task');
  });

  it('callout: peels the title header and recurses children', () => {
    const body =
      '<aside data-callout="note" data-collapsed="true"><header data-block="calloutTitle">Heads up</header><p>body</p></aside>';
    const block = htmlBodyToBlocks(body)[0]!;
    expect(block.kind).toBe('callout');
    const c = block as Extract<RobinBlock, { kind: 'callout' }>;
    expect(c.calloutType).toBe('note');
    expect(c.collapsed).toBe(true);
    expect(c.title).toBe('Heads up');
    expect(c.children[0]?.kind).toBe('paragraph');
    // And it round-trips.
    expect(blocksToBodyHtml(htmlBodyToBlocks(body))).toBe(body);
  });

  it('image block round-trips a <figure data-embed="image"> exactly', () => {
    const body = '<figure data-embed="image"><img alt="x" src="y.png"></figure>';
    expect(blocksToBodyHtml(htmlBodyToBlocks(body))).toBe(body);
  });

  it('html{raw} fallback: unknown markup converges on the 2nd pass', () => {
    const body = '<div class="chart"><svg viewBox="0 0 10 10"></svg></div>';
    const once = blocksToBodyHtml(htmlBodyToBlocks(body));
    const twice = blocksToBodyHtml(htmlBodyToBlocks(once));
    // First pass may normalize; from there it is a stable fixed point.
    expect(twice).toBe(once);
    // And it was captured as a raw passthrough, not dropped.
    expect(htmlBodyToBlocks(body)[0]?.kind).toBe('html');
  });

  it('codeBlock preserves entity-decoded source and language', () => {
    const block = htmlBodyToBlocks('<pre data-lang="ts"><code>a &lt; b &amp;&amp; c &gt; d</code></pre>')[0]!;
    expect(block.kind).toBe('codeBlock');
    const cb = block as Extract<RobinBlock, { kind: 'codeBlock' }>;
    expect(cb.lang).toBe('ts');
    expect(cb.code).toBe('a < b && c > d');
  });
});
