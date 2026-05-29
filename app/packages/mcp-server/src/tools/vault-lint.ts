/**
 * vault.lint — Structural lint checks on the vault.
 *
 * Checks: frontmatter, links (broken wikilinks), orphans, staleness.
 * Initial impl focuses on broken wikilinks and missing required frontmatter fields.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod/v4';
import { parseRobinHtml } from '@robin/indexer';
import { findVaultHtmlFiles } from '../html-utils.js';
import type { ToolContext, VaultLintOutput, LintIssue, LintCheck } from '../types.js';

const REQUIRED_META_FIELDS = ['robin:type', 'robin:slug', 'robin:path', 'robin:updated'];

export const VaultLintInputSchema = z.object({
  check: z
    .array(z.enum(['frontmatter', 'links', 'orphans', 'staleness']))
    .optional()
    .describe('Which checks to run; defaults to all'),
});

export type VaultLintInput = z.infer<typeof VaultLintInputSchema>;

export async function vaultLint(
  input: VaultLintInput,
  ctx: ToolContext
): Promise<VaultLintOutput> {
  const checks: Set<LintCheck> = new Set(
    input.check ?? ['frontmatter', 'links', 'orphans', 'staleness']
  );
  const issues: LintIssue[] = [];

  // Collect all HTML files (knowledge vault only — skips node_modules, repos/, etc.)
  const htmlFiles = findVaultHtmlFiles(ctx.vaultPath);

  // Build resolution sets for link checking:
  //   slugSet  — basename slugs (bare wikilinks like [[some-person]])
  //   pathSet  — vault-relative paths without '.html' (path-like wikilinks
  //              like [[features/images]] or [[projects/_index]])
  const slugSet = new Set<string>();
  const pathSet = new Set<string>();
  const parsedPages: Array<{ relPath: string; slug: string; parsed: ReturnType<typeof parseRobinHtml> }> = [];

  for (const absPath of htmlFiles) {
    try {
      const html = fs.readFileSync(absPath, 'utf8');
      const parsed = parseRobinHtml(html);
      const relPath = path.relative(ctx.vaultPath, absPath);
      const slug = path.basename(absPath, '.html');
      slugSet.add(slug);
      pathSet.add(relPath.replace(/\\/g, '/').replace(/\.html$/, ''));
      parsedPages.push({ relPath, slug, parsed });
    } catch {
      // unreadable file
    }
  }

  // A wikilink target resolves if it matches a basename slug or, when path-like,
  // an exact or suffix match against a page's vault-relative path.
  const resolves = (target: string): boolean => {
    if (target.includes('/')) {
      for (const p of pathSet) {
        if (p === target || p.endsWith(`/${target}`)) return true;
      }
      return false;
    }
    return slugSet.has(target);
  };

  for (const { relPath, slug, parsed } of parsedPages) {
    const m = parsed.meta as Record<string, string | string[]>;

    // ── frontmatter checks ───────────────────────────────────────────────
    if (checks.has('frontmatter')) {
      for (const field of REQUIRED_META_FIELDS) {
        if (!m[field]) {
          issues.push({
            path: relPath,
            slug,
            check: 'frontmatter',
            severity: 'error',
            message: `Missing required meta field: ${field}`,
          });
        }
      }
    }

    // ── link checks (broken wikilinks) ───────────────────────────────────
    if (checks.has('links')) {
      for (const target of parsed.wikilinkTargets) {
        if (!resolves(target)) {
          // Check indexer for aliases
          let resolved = false;
          if (ctx.indexer) {
            try {
              const stmt = ctx.indexer.db.prepare('SELECT slug FROM wikilinks WHERE slug = ?');
              resolved = !!stmt.get(target);
            } catch {
              // ignore
            }
          }
          if (!resolved) {
            issues.push({
              path: relPath,
              slug,
              check: 'links',
              severity: 'warning',
              message: `Broken wikilink: [[${target}]] — no page found with this slug`,
            });
          }
        }
      }
    }

    // ── staleness checks ─────────────────────────────────────────────────
    if (checks.has('staleness')) {
      const updated = Array.isArray(m['robin:updated'])
        ? m['robin:updated'][0]
        : m['robin:updated'];
      if (updated) {
        const updatedDate = new Date(updated);
        const ageMs = Date.now() - updatedDate.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        const type = Array.isArray(m['robin:type']) ? m['robin:type'][0] : m['robin:type'];
        // Tasks older than 30 days without completion are stale
        if (type === 'task' && ageDays > 30) {
          // Tasks stamp `robin:status` on disk while a handful use `robin:state`;
          // the two are synonyms, so fall back to status (mirror read-page.ts
          // buildMeta) or a `status: done` task is falsely flagged stale.
          const stateRaw = m['robin:state'] ?? m['robin:status'];
          const state = Array.isArray(stateRaw) ? stateRaw[0] : stateRaw;
          if (state !== 'done' && state !== 'archived') {
            issues.push({
              path: relPath,
              slug,
              check: 'staleness',
              severity: 'warning',
              message: `Stale task: last updated ${Math.floor(ageDays)} days ago`,
            });
          }
        }
      }
    }
  }

  // ── orphan checks ────────────────────────────────────────────────────────
  if (checks.has('orphans')) {
    // Build set of all linked-to targets (bare slugs and path-like refs)
    const linkedTargets = new Set<string>();
    for (const { parsed } of parsedPages) {
      for (const target of parsed.wikilinkTargets) {
        linkedTargets.add(target);
      }
    }

    // A page is linked if any page references its basename slug or any
    // path suffix of its vault-relative path (e.g. [[features/images]]).
    const isLinked = (relPath: string, slug: string): boolean => {
      if (linkedTargets.has(slug)) return true;
      const noExt = relPath.replace(/\\/g, '/').replace(/\.html$/, '');
      const parts = noExt.split('/');
      for (let i = parts.length - 1; i >= 0; i--) {
        if (linkedTargets.has(parts.slice(i).join('/'))) return true;
      }
      return false;
    };

    for (const { relPath, slug, parsed } of parsedPages) {
      const m = parsed.meta as Record<string, string | string[]>;
      const type = Array.isArray(m['robin:type']) ? m['robin:type'][0] : m['robin:type'];
      // Skip index pages and meeting/interview pages
      if (type === 'index' || type === 'meeting' || type === 'interview') continue;
      // _index pages are hubs, not orphans
      if (path.basename(relPath, '.html') === '_index') continue;

      if (!isLinked(relPath, slug)) {
        issues.push({
          path: relPath,
          slug,
          check: 'orphans',
          severity: 'warning',
          message: `Orphan page: no other page links to [[${slug}]]`,
        });
      }
    }
  }

  return { issues };
}
