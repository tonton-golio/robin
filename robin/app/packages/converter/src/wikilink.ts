import type { Root, Parent, Text, PhrasingContent } from 'mdast';
import { visit } from 'unist-util-visit';
import { slugify } from './meta.js';

/**
 * Custom mdast wikilink node. Inserted by transformWikilinks().
 * `slug` is the raw target before alias parsing. Resolution to a file path
 * happens at render time via the indexer's wikilinks table.
 */
export interface MdWikilink {
  type: 'wikilink';
  slug: string;
  alias?: string;
  /**
   * Marks an `![[...]]` image embed (vs a `[[...]]` link). A dedicated flag
   * rather than overloading `alias` so a legitimate link whose display text is
   * literally "embed" (`[[page|embed]]`) is NOT mistaken for an embed.
   */
  embed?: boolean;
  data?: { hName?: string; hProperties?: Record<string, unknown>; hChildren?: unknown[] };
}

// `![[target]]` (embed) or `[[target]]` (link), optional `|alias`.
// We match the *whole* token; we won't recurse into code spans (handled below).
const WIKILINK_RE = /(!?)\[\[([^\]\n|]+?)(?:\|([^\]\n]+?))?\]\]/g;

/**
 * Remark plugin: walks all text nodes (outside of code) and replaces
 * `[[slug]]` / `[[slug|alias]]` tokens with a custom `wikilink` node.
 * `![[image.png]]` becomes an `embeddedImage` wikilink (alias unused).
 *
 * Code spans and code blocks are skipped automatically because `visit`
 * with type `text` doesn't descend into `inlineCode`/`code` content
 * (inlineCode's value isn't a child text node).
 */
export function remarkWikilink() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent: Parent | null | undefined) => {
      if (!parent || index == null) return;
      const value = node.value;
      if (!value.includes('[[')) return;

      WIKILINK_RE.lastIndex = 0;
      const newChildren: PhrasingContent[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let found = false;

      while ((match = WIKILINK_RE.exec(value)) !== null) {
        found = true;
        const [whole, bang, rawTarget, rawAlias] = match;
        const start = match.index;
        if (start > lastIndex) {
          newChildren.push({ type: 'text', value: value.slice(lastIndex, start) } as Text);
        }
        const target = rawTarget!.trim();
        const alias = rawAlias?.trim();

        // Embed: ![[image.png]] — we render as a paragraph-level node so it's
        // handled at the block layer in mdast-to-blocks; here we emit a
        // wikilink-ish phrasing node (flagged `embed:true`) and let the block
        // converter detect it. The optional `alias` is the author caption/alt
        // text (e.g. ![[image.png|My caption]]) and is carried through verbatim.
        if (bang === '!') {
          newChildren.push({
            type: 'wikilink',
            slug: target, // KEEP raw (e.g. "image.png"), no slugify for embeds
            embed: true,
            ...(alias ? { alias } : {}),
          } as unknown as PhrasingContent);
        } else {
          // Normal wikilink. Slugify the target unless it already looks like a slug.
          const slug = target.includes('/') || /\.[a-z]{2,4}$/i.test(target)
            ? target // path-like; preserve verbatim — resolver handles
            : looksLikeSlug(target)
              ? target.toLowerCase()
              : slugify(target);
          newChildren.push({
            type: 'wikilink',
            slug,
            ...(alias ? { alias } : {}),
          } as unknown as PhrasingContent);
        }
        lastIndex = start + whole.length;
      }
      if (!found) return;
      if (lastIndex < value.length) {
        newChildren.push({ type: 'text', value: value.slice(lastIndex) } as Text);
      }
      (parent.children as PhrasingContent[]).splice(index, 1, ...newChildren);
      return [/* SKIP */ 'skip', index + newChildren.length];
    });
  };
}

function looksLikeSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/i.test(s);
}
