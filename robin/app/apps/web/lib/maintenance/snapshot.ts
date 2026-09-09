import type {
  HealthMetric,
  HealthSection,
  HealthStatus,
  HealthStripEntry,
  MaintenanceSnapshot,
} from './types';
import path from 'path';
import { locateVault } from '@/lib/vault';
import { normalizeLimit, openReadOnlyDb, severityRank, type SqliteDb } from './shared';
import type { MaintenanceItem } from './types';
import { getAnnotationSection, annotationItem } from './annotations';
import { getStalePagesSection, stalePageItem } from './stale-pages';
import { getWikiSection, metaIssueItem, orphanItem, wikiLinkItem } from './wiki';
import { getTaskIntegritySection, taskMaintenanceItem } from './tasks';
import { getMemoryHealthSection, memoryItems } from './memory';
import { getOutputHygieneSection, outputMaintenanceItem } from './outputs';
import { getIndexHealthSection } from './index-health';
import { getCompositionSection, getAmbiguousSlugs } from './composition';
import { getCadenceSection } from './cadence';

interface SnapshotOptions {
  limit?: number;
}

// Thresholds for the cadence section (days without a new log entry).
const CHANGELOG_STALE_DAYS = 4;
const INGEST_STALE_DAYS = 21;
const STATUS_ORDER: Record<HealthStatus, number> = { ok: 0, warn: 1, critical: 2 };

function worst(...statuses: HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>((acc, s) => (STATUS_ORDER[s] > STATUS_ORDER[acc] ? s : acc), 'ok');
}

export async function getMaintenanceSnapshot(options: SnapshotOptions = {}): Promise<MaintenanceSnapshot> {
  const generatedAt = new Date().toISOString();
  const limit = normalizeLimit(options.limit);

  // F5: open the index db ONCE, read-only, and share the handle across the four
  // db-backed scanners (index-health, composition, ambiguous slugs, stale
  // pages) instead of opening + migrating it four times per render. Closed in
  // finally. better-sqlite3 is synchronous, so the "parallel" scanners never
  // touch the handle concurrently. null → each scanner degrades gracefully.
  const dbPath = path.join(locateVault(), '.robin', 'index.db');
  let db: SqliteDb | null = null;
  try {
    db = openReadOnlyDb(dbPath);
  } catch {
    db = null;
  }

  let sections: HealthSection[];
  let indexHealth: Awaited<ReturnType<typeof getIndexHealthSection>>;
  let wiki: Awaited<ReturnType<typeof getWikiSection>>;
  let tasks: Awaited<ReturnType<typeof getTaskIntegritySection>>;
  let ambiguousSlugs: Awaited<ReturnType<typeof getAmbiguousSlugs>>;
  let stalePages: Awaited<ReturnType<typeof getStalePagesSection>>;
  let memory: Awaited<ReturnType<typeof getMemoryHealthSection>>;
  let composition: Awaited<ReturnType<typeof getCompositionSection>>;
  let cadence: Awaited<ReturnType<typeof getCadenceSection>>;
  let annotations: Awaited<ReturnType<typeof getAnnotationSection>>;
  let outputs: Awaited<ReturnType<typeof getOutputHygieneSection>>;

  try {
    [
      indexHealth,
      wiki,
      tasks,
      ambiguousSlugs,
      stalePages,
      memory,
      composition,
      cadence,
      annotations,
      outputs,
    ] = await Promise.all([
      getIndexHealthSection(db),
      getWikiSection(limit),
      getTaskIntegritySection(limit),
      getAmbiguousSlugs(db),
      getStalePagesSection(limit, db),
      getMemoryHealthSection(limit),
      getCompositionSection(db),
      getCadenceSection(generatedAt),
      getAnnotationSection(limit),
      getOutputHygieneSection(generatedAt, limit),
    ]);
  } finally {
    try {
      db?.close();
    } catch {
      // snapshot already assembled; nothing useful to report.
    }
  }

  sections = [];

  // 1. Index & engine health -------------------------------------------------
  {
    // F4: a probe error (open failed / query threw) after the db file is
    // confirmed present is a WARN with the real error — NOT a "staleness column
    // missing" CRITICAL. The column-missing verdict only fires when the PRAGMA
    // probe actually ran and found the column absent (no probeError).
    const { dbPresent, probeError } = indexHealth;
    const columnMissing = dbPresent && !probeError && !indexHealth.stalenessColumn;
    const status: HealthStatus = !dbPresent || columnMissing
      ? 'critical'
      : probeError || indexHealth.indexStale
        ? 'warn'
        : 'ok';
    const metrics: HealthMetric[] = [
      { label: 'Index db', value: dbPresent ? 'present' : 'missing', status: dbPresent ? 'ok' : 'critical' },
      {
        label: 'Staleness column',
        value: probeError ? 'unknown' : indexHealth.stalenessColumn ? 'present' : 'missing',
        status: probeError ? 'warn' : indexHealth.stalenessColumn ? 'ok' : 'critical',
      },
      {
        label: 'Index freshness',
        value: !dbPresent
          ? 'n/a'
          : indexHealth.indexStale
            ? `${formatLag(indexHealth.lagMinutes)} behind`
            : 'up to date',
        status: indexHealth.indexStale ? 'warn' : 'ok',
        hint: indexHealth.newestBrainFile ? `newest brain file: ${indexHealth.newestBrainFile}` : undefined,
      },
      { label: 'Indexed pages', value: indexHealth.indexedPages ?? '—' },
      { label: 'Last reindex', value: indexHealth.lastReindex ? formatDate(indexHealth.lastReindex) : '—' },
      // db file mtime is a displayed diagnostic only (it lags under WAL); the
      // freshness verdict above comes from MAX(indexed_at), not this.
      { label: 'DB file mtime', value: indexHealth.dbMtime ? formatDate(indexHealth.dbMtime) : '—' },
      { label: 'Last decay sweep', value: indexHealth.decayLastSwept ? formatDate(indexHealth.decayLastSwept) : '—' },
    ];
    sections.push({
      id: 'index-health',
      title: indexHealth.title,
      status,
      source: indexHealth.source,
      summary: !dbPresent
        ? `Index db is missing (${indexHealth.reason ?? 'unknown'}).`
        : columnMissing
          ? 'Index db is present but the staleness column is missing — run a reindex.'
          : probeError
            ? `Index db present but the health probe failed: ${probeError}.`
            : indexHealth.indexStale
              ? `Index trails brain by ${formatLag(indexHealth.lagMinutes)}; a reindex would refresh search/decay.`
              : 'Index is present, current, and decay-aware.',
      metrics,
      items: [],
    });
  }

  // 2. Format & link integrity (wiki + ambiguous slugs + task integrity) ------
  {
    const ambiguousCount = ambiguousSlugs.count ?? 0;
    const lintIssues = wiki.brokenWikilinkCount + wiki.orphanCount + wiki.metaIssueCount;
    const totalIssues = lintIssues + tasks.issueCount + ambiguousCount;
    const hasCritical = wiki.parseErrors > 0 || tasks.parseErrors > 0 || wiki.metaIssues.some((m) => m.severity === 'critical');
    const status: HealthStatus = hasCritical ? 'critical' : totalIssues > 0 ? 'warn' : 'ok';
    const metrics: HealthMetric[] = [
      { label: 'Pages scanned', value: wiki.pagesScanned },
      { label: 'Broken wikilinks', value: wiki.brokenWikilinkCount, status: wiki.brokenWikilinkCount > 0 ? 'warn' : 'ok' },
      { label: 'Orphan pages', value: wiki.orphanCount, status: wiki.orphanCount > 0 ? 'warn' : 'ok' },
      { label: 'Meta issues', value: wiki.metaIssueCount, status: wiki.metaIssueCount > 0 ? 'warn' : 'ok' },
      {
        label: 'Ambiguous slugs',
        value: ambiguousSlugs.count ?? '—',
        status: ambiguousCount > 0 ? 'warn' : 'ok',
      },
      {
        label: 'Task integrity',
        value: tasks.issueCount,
        status: tasks.parseErrors > 0 ? 'critical' : tasks.issueCount > 0 ? 'warn' : 'ok',
        hint: `${tasks.missingOwner} missing owner · ${tasks.missingPriority} missing priority · ${tasks.openInArchive} open in archive`,
      },
      { label: 'Parse errors', value: wiki.parseErrors + tasks.parseErrors, status: wiki.parseErrors + tasks.parseErrors > 0 ? 'critical' : 'ok' },
    ];
    const ambiguousItems: MaintenanceItem[] = ambiguousSlugs.slugs.map((slug) => ({
      id: `ambiguous-slug:${slug}`,
      title: slug,
      detail: 'ambiguous wikilink slug (resolves to multiple pages)',
      severity: 'warning' as const,
    }));
    const items = [
      ...wiki.brokenWikilinks.map(wikiLinkItem),
      ...wiki.orphans.map(orphanItem),
      ...wiki.metaIssues.map(metaIssueItem),
      ...tasks.items.map(taskMaintenanceItem),
      ...ambiguousItems,
    ]
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.title.localeCompare(b.title))
      .slice(0, limit);
    sections.push({
      id: 'integrity',
      title: 'Format & link integrity',
      status,
      source: 'brain/**/*.html',
      summary: `${wiki.pagesScanned} pages scanned; ${wiki.brokenWikilinkCount} broken links, ${wiki.orphanCount} orphans, ${wiki.metaIssueCount} meta issues, ${ambiguousCount} ambiguous slugs, ${tasks.issueCount} task-integrity issues.`,
      metrics,
      itemsLabel: 'Integrity issues',
      items,
    });
  }

  // 3. Knowledge decay -------------------------------------------------------
  {
    const status: HealthStatus = !stalePages.available ? 'warn' : stalePages.total > 0 ? 'warn' : 'ok';
    const byTier = new Map<string, number>();
    for (const page of stalePages.items) {
      const tier = page.tier ?? 'untiered';
      byTier.set(tier, (byTier.get(tier) ?? 0) + 1);
    }
    const metrics: HealthMetric[] = [
      { label: 'Stale pages', value: stalePages.available ? stalePages.total : 'n/a', status: stalePages.total > 0 ? 'warn' : 'ok' },
      ...[...byTier.entries()].sort((a, b) => b[1] - a[1]).map(([tier, count]) => ({ label: `Tier: ${tier}`, value: count })),
    ];
    sections.push({
      id: 'decay',
      title: 'Knowledge decay',
      status,
      source: stalePages.source,
      summary: stalePages.available
        ? `${stalePages.total} indexed pages are stale (staleness > 0.7, unaccessed 60d+).`
        : `Stale index unavailable: ${stalePages.reason ?? 'unknown'}.`,
      metrics,
      itemsLabel: 'Top stale pages',
      items: stalePages.items.map(stalePageItem),
    });
  }

  // 4. Memory health ---------------------------------------------------------
  {
    const memIssues = memory.malformedEvents + memory.tentative + memory.rejected + memory.superseded;
    const status: HealthStatus = memory.malformedEvents > 0 ? 'critical' : memIssues > 0 ? 'warn' : 'ok';
    const metrics: HealthMetric[] = [
      { label: 'Current memories', value: memory.currentMemories },
      { label: 'Total events', value: memory.totalEvents },
      { label: 'Malformed events', value: memory.malformedEvents, status: memory.malformedEvents > 0 ? 'critical' : 'ok' },
      { label: 'Tentative', value: memory.tentative, status: memory.tentative > 0 ? 'warn' : 'ok' },
      { label: 'Rejected', value: memory.rejected, status: memory.rejected > 0 ? 'warn' : 'ok' },
      { label: 'Superseded', value: memory.superseded, status: memory.superseded > 0 ? 'warn' : 'ok' },
    ];
    sections.push({
      id: 'memory',
      title: memory.title,
      status,
      source: memory.source,
      summary: `${memory.currentMemories} current memories; ${memory.malformedEvents} malformed, ${memory.tentative} tentative, ${memory.rejected} rejected, ${memory.superseded} superseded.`,
      metrics,
      itemsLabel: 'Flagged memories',
      items: memoryItems(memory, limit),
    });
  }

  // 5. Vault composition (informational) -------------------------------------
  {
    const metrics: HealthMetric[] = composition.available
      ? [
          { label: 'Total pages', value: composition.pages },
          { label: 'Total links', value: composition.links },
          ...composition.byType.slice(0, 8).map((row) => ({ label: `Type: ${row.label}`, value: row.count })),
        ]
      : [{ label: 'Composition', value: 'unavailable', status: 'warn' as HealthStatus }];
    sections.push({
      id: 'composition',
      title: composition.title,
      status: composition.available ? 'ok' : 'warn',
      source: composition.source,
      summary: composition.available
        ? `${composition.pages} pages across ${composition.byType.length} types and ${composition.byTier.length} tiers; ${composition.links} links.`
        : `Composition unavailable: ${composition.reason ?? 'unknown'}.`,
      metrics,
      itemsLabel: 'By tier',
      items: composition.byTier.map((row) => ({
        id: `tier:${row.label}`,
        title: row.label,
        detail: `${row.count} pages`,
        severity: 'info' as const,
      })),
    });
  }

  // 6. Operational cadence ---------------------------------------------------
  {
    const changelogStale = cadence.changelog.daysSince !== null && cadence.changelog.daysSince > CHANGELOG_STALE_DAYS;
    const ingestStale = cadence.ingestLog.daysSince !== null && cadence.ingestLog.daysSince > INGEST_STALE_DAYS;
    const status: HealthStatus = changelogStale || ingestStale || annotations.openCount > 0 ? 'warn' : 'ok';
    const metrics: HealthMetric[] = [
      {
        label: 'Changelog',
        value: formatDaysSince(cadence.changelog.daysSince),
        status: changelogStale ? 'warn' : 'ok',
        hint: cadence.changelog.lastEntry ? `last entry ${cadence.changelog.lastEntry}` : undefined,
      },
      {
        label: 'Ingest log',
        value: formatDaysSince(cadence.ingestLog.daysSince),
        status: ingestStale ? 'warn' : 'ok',
        hint: cadence.ingestLog.lastEntry ? `last entry ${cadence.ingestLog.lastEntry}` : undefined,
      },
      { label: `Edits (${cadence.editLogMonth})`, value: cadence.editLogVolume },
      { label: 'Open annotations', value: annotations.openCount, status: annotations.openCount > 0 ? 'warn' : 'ok' },
    ];
    sections.push({
      id: 'cadence',
      title: cadence.title,
      status,
      summary: `Changelog ${formatDaysSince(cadence.changelog.daysSince)}, ingest log ${formatDaysSince(cadence.ingestLog.daysSince)}, ${cadence.editLogVolume} edits this month, ${annotations.openCount} open annotations.`,
      metrics,
      itemsLabel: 'Open annotations',
      items: annotations.items.map(annotationItem),
    });
  }

  // 7. Output hygiene --------------------------------------------------------
  {
    const status: HealthStatus = outputs.issueCount > 0 ? 'warn' : 'ok';
    const metrics: HealthMetric[] = [
      { label: 'Output files', value: outputs.total },
      { label: 'Archive candidates', value: outputs.archiveCandidates, status: outputs.archiveCandidates > 0 ? 'warn' : 'ok' },
      { label: 'Root-level files', value: outputs.rootFiles, status: outputs.rootFiles > 0 ? 'warn' : 'ok' },
      { label: 'Large files', value: outputs.largeFiles, status: outputs.largeFiles > 0 ? 'warn' : 'ok' },
    ];
    sections.push({
      id: 'outputs',
      title: outputs.title,
      status,
      source: outputs.source,
      summary: `${outputs.total} output files; ${outputs.archiveCandidates} archive candidates, ${outputs.rootFiles} root files, ${outputs.largeFiles} large files.`,
      metrics,
      itemsLabel: 'Flagged outputs',
      items: outputs.items.map(outputMaintenanceItem),
    });
  }

  const statusCounts: Record<HealthStatus, number> = { ok: 0, warn: 0, critical: 0 };
  for (const section of sections) statusCounts[section.status] += 1;

  const strip: HealthStripEntry[] = sections.map((section) => ({
    id: section.id,
    title: section.title,
    status: section.status,
    headline: section.summary,
  }));

  return {
    generatedAt,
    overall: worst(...sections.map((s) => s.status)),
    statusCounts,
    strip,
    sections,
  };
}

function formatLag(minutes: number | null): string {
  if (minutes === null) return 'unknown';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (60 * 24))}d`;
}

function formatDaysSince(days: number | null): string {
  if (days === null) return 'no entries';
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
