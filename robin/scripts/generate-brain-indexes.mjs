#!/usr/bin/env node
/** Derived navigation only. Default is a dry run; --write uses durable vault IO. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { robinMetaValues } from './html-contract.mjs';

const terminal = new Set(['done', 'cancelled', 'dropped', 'superseded', 'archived']);
const isArchivePath = relPath => relPath.split('/').some(part => ['archive', 'archives', 'archived'].includes(part.toLowerCase()));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const link = page => `<a data-wiki="${escape(page.path.replace(/\.html$/, ''))}" href="/p/${escape(page.path.replace(/\.html$/, ''))}">${escape(page.title)}</a>`;
const list = pages => `<ul data-block="bulletList">${pages.map(page => `<li>${link(page)}</li>`).join('')}</ul>`;

export async function readPages(vault) {
  const pages = [];
  async function visit(dir) {
    for (const entry of await fs.readdir(path.join(vault, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await visit(rel);
      else if (entry.isFile() && entry.name.endsWith('.html')) {
        const html = await fs.readFile(path.join(vault, rel), 'utf8');
        const values = robinMetaValues(html);
        const meta = Object.fromEntries([...values].map(([key, values]) => [key.slice(6), values[0]]));
        // Slugs are deliberately not identities: many indexes share _index.
        pages.push({ path: rel, html, meta, tags: values.get('robin:tag') ?? [], title: meta.title || rel.split('/').at(-1).replace(/\.html$/, '').replaceAll('-', ' ') });
        const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
        if (title) pages.at(-1).title = title.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
      }
    }
  }
  await visit('brain');
  return pages.sort((a, b) => a.path.localeCompare(b.path));
}

export function deriveIndexes(pages) {
  const current = pages.filter(p => !isArchivePath(p.path) && !p.path.endsWith('/_index.html'));
  const result = new Map();
  const section = (title, rows) => rows.length ? `<h2>${escape(title)}</h2>${list(rows)}` : '';
  const rootGroups = [
    ['Projects and direction', ['brain/projects/_index.html', 'brain/strategy/_index.html']],
    ['People and personal context', ['brain/people/_index.html', ...pages.filter(p => /^brain\/about_[^/]+\/_index\.html$/.test(p.path)).map(p => p.path)]],
    ['Commitments and decisions', ['brain/tasks/_index.html', 'brain/decisions/_index.html']],
    ['Thinking and open questions', ['brain/thinking/_index.html', 'brain/unknowns/_index.html']],
    ['Reference', ['brain/playbooks/_index.html', 'brain/patterns/_index.html', 'brain/standards/_index.html', 'brain/hubs/_index.html', 'brain/repos/_index.html', 'brain/tools/_index.html']],
    ['History and recall', ['brain/memory/_index.html', 'brain/annotations/_index.html', 'brain/work-log/_index.html']],
  ];
  result.set('brain/_index.html', {
    title: 'Brain — navigation', summary: 'Navigation to canonical knowledge, thinking, commitments and reference. Current overview is derived in Robin.',
    body: '<p>Start with <a href="/">Robin’s current overview</a> (agent JSON: <code>/api/overview</code>). It derives current work from the underlying records and shows source coverage. When Robin is unavailable, follow the canonical pages below and check their dates and evidence.</p>' + rootGroups.map(([title, paths]) => section(title, paths.map(ref => { const page = pages.find(p => p.path === ref); return page ? { ...page, title: ({ 'brain/tasks/_index.html': 'Commitments and tasks', 'brain/thinking/_index.html': 'Thinking', 'brain/projects/_index.html': 'Projects' })[ref] ?? page.title } : null; }).filter(Boolean))).join('') + '<p>Original sources live in <code>inbox/</code>; meeting summaries in <code>logs/meetings/</code>; dated briefs and reports in <code>logs/reports/</code>; deliverables in <code>out/</code>. Historical material remains available through archives and page history.</p>',
  });
  for (const [folder, title, description] of [
    ['people', 'People', 'Directory of canonical people records. Roles, employment and reporting evidence belong on individual profiles.'],
    ['strategy', 'Strategy', 'Canonical direction and planning records. Read their evidence and dates before using them as current priorities.'],
    ['decisions', 'Decisions', 'Decision records retain authority, rationale and supersession history. Open a record for the actual decision.'],
  ]) {
    const direct = current.filter(p => path.posix.dirname(p.path) === `brain/${folder}`);
    const indexes = pages.filter(p => p.path.startsWith(`brain/${folder}/`) && p.path.endsWith('/_index.html') && p.path !== `brain/${folder}/_index.html` && !isArchivePath(p.path));
    result.set(`brain/${folder}/_index.html`, { title, summary: description, body: `<p>${description}</p>` + section('Records', direct) + section('Directories', indexes.map(p => ({ ...p, title: p.path === 'brain/people/team/_index.html' ? 'Team directory' : p.title }))) });
  }
  result.set('brain/projects/_index.html', {
    title: 'Projects', summary: 'Generated project navigation. Status, owners and checkpoints belong to each canonical project.',
    body: '<p>Open a project for its current state, owner, next checkpoint and evidence. Proposals remain separate from commitments. The live overview reads metadata directly.</p>' +
      section('Projects', current.filter(p => p.meta.type === 'project' && !p.path.includes('/_future/'))) +
      section('Components', current.filter(p => p.meta.type === 'feature' && !p.path.includes('/_future/'))) +
      section('Future proposals', pages.filter(p => p.path === 'brain/projects/_future/_index.html')) +
      section('Direction', pages.filter(p => p.path === 'brain/strategy/_index.html')),
  });
  result.set('brain/people/team/_index.html', {
    title: 'Team directory', summary: 'Generated directory of current team profiles. Employment evidence and role history remain on each profile.',
    body: '<p>Profiles are authoritative for employment, role, onboarding and evidence. This directory carries links only; it does not repeat staffing or salary assumptions. Historical versions of this directory remain in page history.</p>' + list(current.filter(p => p.path.startsWith('brain/people/team/') && p.meta.type === 'person')) + section('People directory', pages.filter(p => p.path === 'brain/people/_index.html')),
  });
  const tasks = current.filter(p => p.meta.type === 'task');
  const active = tasks.filter(p => !terminal.has(p.meta.status ?? p.meta.state));
  const leaves = active.filter(p => !['outcome', 'workstream'].includes(p.meta.kind));
  const table = rows => `<table><thead><tr><th>Task</th><th>Owner</th><th>Recorded status</th><th>Next action</th></tr></thead><tbody>${rows.map(p => `<tr><td>${link(p)}</td><td>${escape(p.meta.owner || 'Unassigned')}</td><td>${escape(p.meta.status || p.meta.state || 'Unknown')}</td><td>${escape(p.meta.next_action || 'Needs clarification')}</td></tr>`).join('')}</tbody></table>`;
  result.set('brain/tasks/_index.html', {
    title: 'Commitments and tasks', summary: 'Generated task navigation. Recorded priorities are not renewed commitments; missing next actions remain visible.',
    body: '<p>Derived from task metadata. Recorded priorities and dates need evidence before they are treated as current commitments. Missing next actions are surfaced for clarification. The live overview reads the task records directly.</p>' +
      ['p0', 'p1', 'p2', 'p3'].map(priority => { const rows = leaves.filter(p => p.meta.priority?.toLowerCase() === priority); return rows.length ? `<h2>${priority === 'p3' ? 'Backlog — P3' : priority.toUpperCase()}</h2>${table(rows)}` : ''; }).join('') +
      section('Unranked tasks', leaves.filter(p => !['p0', 'p1', 'p2', 'p3'].includes(p.meta.priority?.toLowerCase()))) +
      section('Outcomes and workstreams', active.filter(p => ['outcome', 'workstream'].includes(p.meta.kind))) +
      section('Completed or superseded — retained until archive rotation', tasks.filter(p => terminal.has(p.meta.status ?? p.meta.state))) +
      '<p>Archived tasks remain under <code>brain/tasks/archive/</code>. Outcomes group work; closing a parent never closes its children.</p>',
  });
  result.set('brain/thinking/_index.html', {
    title: 'Thinking', summary: 'Ideas and hypotheses, explicitly separate from confirmed facts and commitments.',
    body: '<p>Working thoughts retain their author’s perspective, supporting and contrary evidence, and a review trigger. A thought may lead to a decision or task; it is not itself a commitment. Small thoughts stay within the relevant project or person page.</p>' +
      section('Working notes and proposals', current.filter(p => p.tags.includes('thought'))) +
      section('Open questions', pages.filter(p => p.path === 'brain/unknowns/_index.html')),
  });
  return result;
}

export async function generateIndexes(vault, { write = false, now = new Date(), sections = [] } = {}) {
  for (const section of sections) {
    if (!/^brain\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/.test(section) || isArchivePath(section)) {
      throw new Error(`Section must be a current directory under brain/: ${section}`);
    }
  }
  const pages = await readPages(vault);
  // Include every generated destination in the same plan, even on a new vault.
  for (const [rel, title] of [['brain/_index.html', 'Brain — navigation'], ['brain/projects/_index.html', 'Projects'], ['brain/tasks/_index.html', 'Commitments and tasks'], ['brain/people/team/_index.html', 'Team directory'], ['brain/thinking/_index.html', 'Thinking'], ['brain/people/_index.html', 'People'], ['brain/strategy/_index.html', 'Strategy'], ['brain/decisions/_index.html', 'Decisions']]) {
    if (!pages.some(p => p.path === rel)) pages.push({ path: rel, title, meta: { type: 'index' }, tags: [] });
  }
  const plans = deriveIndexes(pages);
  for (const directory of sections) {
    const rel = `${directory}/_index.html`;
    const index = pages.find(p => p.path === rel);
    if (!index) throw new Error(`Section index must already exist: ${rel}`);
    const records = pages.filter(p => path.posix.dirname(p.path) === directory && p.path !== rel && !isArchivePath(p.path));
    const children = pages.filter(p => p.path.endsWith('/_index.html') && path.posix.dirname(path.posix.dirname(p.path)) === directory && !isArchivePath(p.path));
    const summary = 'Generated navigation to canonical records. Implementation, ownership, measurements and acceptance evidence remain on each linked page.';
    plans.set(rel, { title: index.title, summary, body: `<p>${summary}</p><h2>Records</h2>${list(records)}${children.length ? `<h2>Directories</h2>${list(children)}` : ''}` });
  }
  const changed = [];
  const { canonicalizeHtml, normalizeFrontmatter } = await import('../app/packages/converter/dist/index.js');
  const { writeWithHistory, hashHtml } = await import('../app/packages/vault-io/dist/index.js');
  for (const [rel, plan] of plans) {
    const old = pages.find(p => p.path === rel);
    const bodyHtml = `<h1>${escape(plan.title)}</h1>${plan.body}<p><small>Generated navigation. Rebuild with <code>node robin/scripts/generate-brain-indexes.mjs --vault base --write</code>. Page generation time is not evidence freshness.</small></p>`;
    // Compare the body, not the timestamp, to avoid history churn on every run.
    const priorBody = old?.html?.match(/<article\b[^>]*data-robin-doc[^>]*>([\s\S]*?)<\/article>/i)?.[1]?.trim();
    if (priorBody === bodyHtml) continue;
    if (old?.meta?.version === '0.3') throw new Error(`Explicit identity-preserving migration required for ${rel}`);
    const frontmatter = { type: 'index', title: plan.title, summary: plan.summary, updated: now.toISOString() };
    const { meta } = normalizeFrontmatter({ frontmatter, slug: '_index', outputPath: rel, title: plan.title });
    const html = canonicalizeHtml({ meta, frontmatter, blocks: [], bodyHtml, updatedAt: now });
    // Canonical indentation is ignored solely for idempotent body comparison.
    if (old?.html?.replace(/<meta name="robin:updated"[^>]*>/, '') === html.replace(/<meta name="robin:updated"[^>]*>/, '')) continue;
    changed.push(rel);
    if (write) await writeWithHistory({ absolutePath: path.join(vault, rel), vaultRoot: vault, html, origin: 'cli', actor: 'brain-index-generator', expectedHash: old?.html ? hashHtml(old.html) : null, summary: 'Rebuild derived navigation from canonical page metadata' });
  }
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const root = args.indexOf('--vault');
  if (root < 0 || !args[root + 1]) throw new Error('Usage: generate-brain-indexes.mjs --vault <path> [--section brain/path] [--write | --check]');
  const sections = args.flatMap((arg, i) => arg === '--section' ? [args[i + 1] ?? ''] : []);
  const changed = await generateIndexes(path.resolve(args[root + 1]), { write: args.includes('--write'), sections });
  console.log(JSON.stringify({ written: args.includes('--write'), changed }, null, 2));
  if (args.includes('--check') && changed.length) process.exitCode = 1;
}
