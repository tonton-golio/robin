import type { MaintenanceSection, MaintenanceSnapshot } from './types';
import { normalizeLimit, severityRank } from './shared';
import { annotationItem, getAnnotationSection, type AnnotationSection } from './annotations';
import { getStalePagesSection, stalePageItem, type StalePagesSection } from './stale-pages';
import { getWikiSection, metaIssueItem, orphanItem, wikiLinkItem, type WikiSection } from './wiki';
import { getTaskHygieneSection, taskMaintenanceItem, type TaskHygieneSection } from './tasks';
import { getMemoryHealthSection, memoryItems, type MemoryHealthSection } from './memory';
import { getOutputHygieneSection, outputMaintenanceItem, type OutputHygieneSection } from './outputs';

interface SnapshotOptions {
  limit?: number;
}

export async function getMaintenanceSnapshot(options: SnapshotOptions = {}): Promise<MaintenanceSnapshot> {
  const generatedAt = new Date().toISOString();
  const limit = normalizeLimit(options.limit);

  const [annotations, stalePages, wiki, tasks, memory, outputs] = await Promise.all([
    getAnnotationSection(limit),
    getStalePagesSection(limit),
    getWikiSection(limit),
    getTaskHygieneSection(generatedAt, limit),
    getMemoryHealthSection(limit),
    getOutputHygieneSection(generatedAt, limit),
  ]);
  const lintIssues = wiki.brokenWikilinkCount + wiki.orphanCount + wiki.metaIssueCount;
  const memoryIssues = memory.malformedEvents + memory.tentative + memory.rejected + memory.superseded;
  const totalIssues = annotations.openCount
    + stalePages.total
    + lintIssues
    + tasks.issueCount
    + memoryIssues
    + outputs.issueCount;

  return {
    generatedAt,
    counts: {
      openAnnotations: annotations.openCount,
      stalePages: stalePages.total,
      lintIssues,
      taskIssues: tasks.issueCount,
      memoryIssues,
      outputIssues: outputs.issueCount,
      totalIssues,
      brokenWikilinks: wiki.brokenWikilinkCount,
      orphanPages: wiki.orphanCount,
      metaIssues: wiki.metaIssueCount,
      openTasks: tasks.open,
      overdueTasks: tasks.overdue,
      memoryMalformedEvents: memory.malformedEvents,
      memoryTentative: memory.tentative,
      memoryRejected: memory.rejected,
      memorySuperseded: memory.superseded,
      outputArchiveCandidates: outputs.archiveCandidates,
    },
    sections: buildMaintenanceSections({
      annotations,
      stalePages,
      wiki,
      tasks,
      memory,
      outputs,
      limit,
    }),
  };
}

function buildMaintenanceSections(input: {
  annotations: AnnotationSection;
  stalePages: StalePagesSection;
  wiki: WikiSection;
  tasks: TaskHygieneSection;
  memory: MemoryHealthSection;
  outputs: OutputHygieneSection;
  limit: number;
}): MaintenanceSection[] {
  const memoryIssueCount = input.memory.malformedEvents
    + input.memory.tentative
    + input.memory.rejected
    + input.memory.superseded;
  const lintIssueCount = input.wiki.brokenWikilinkCount + input.wiki.orphanCount + input.wiki.metaIssueCount;

  return [
    {
      id: 'annotations',
      title: input.annotations.title,
      summary: `${input.annotations.openCount} open annotations from ${input.annotations.source}.`,
      severity: input.annotations.openCount > 0 ? 'warning' : 'info',
      count: input.annotations.openCount,
      items: input.annotations.items.map(annotationItem),
    },
    {
      id: 'stale-pages',
      title: input.stalePages.title,
      summary: input.stalePages.available
        ? `${input.stalePages.total} indexed pages are stale.`
        : `Stale index unavailable: ${input.stalePages.reason ?? 'unknown'}.`,
      severity: input.stalePages.total > 0 ? 'warning' : 'info',
      count: input.stalePages.total,
      items: input.stalePages.items.map(stalePageItem),
    },
    {
      id: 'wiki',
      title: input.wiki.title,
      summary: `${input.wiki.pagesScanned} pages scanned; ${input.wiki.brokenWikilinkCount} broken links, ${input.wiki.orphanCount} orphans, ${input.wiki.metaIssueCount} meta issues.`,
      severity: input.wiki.metaIssues.some((item) => item.severity === 'critical') ? 'critical' : lintIssueCount > 0 ? 'warning' : 'info',
      count: lintIssueCount,
      items: [
        ...input.wiki.brokenWikilinks.map(wikiLinkItem),
        ...input.wiki.orphans.map(orphanItem),
        ...input.wiki.metaIssues.map(metaIssueItem),
      ]
        .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.title.localeCompare(b.title))
        .slice(0, input.limit),
    },
    {
      id: 'tasks',
      title: input.tasks.title,
      summary: `${input.tasks.open} open tasks; ${input.tasks.overdue} overdue, ${input.tasks.staleOpen} stale, ${input.tasks.openInArchive} open in archive.`,
      severity: input.tasks.overdue > 0 ? 'critical' : input.tasks.issueCount > 0 ? 'warning' : 'info',
      count: input.tasks.issueCount,
      items: input.tasks.items.map(taskMaintenanceItem),
    },
    {
      id: 'memory',
      title: input.memory.title,
      summary: `${input.memory.currentMemories} current memories; ${input.memory.malformedEvents} malformed events, ${input.memory.tentative} tentative, ${input.memory.rejected} rejected, ${input.memory.superseded} superseded.`,
      severity: input.memory.malformedEvents > 0 ? 'critical' : memoryIssueCount > 0 ? 'warning' : 'info',
      count: memoryIssueCount,
      items: memoryItems(input.memory, input.limit),
    },
    {
      id: 'outputs',
      title: input.outputs.title,
      summary: `${input.outputs.total} output files; ${input.outputs.archiveCandidates} archive candidates, ${input.outputs.rootFiles} root files, ${input.outputs.largeFiles} large files.`,
      severity: input.outputs.issueCount > 0 ? 'warning' : 'info',
      count: input.outputs.issueCount,
      items: input.outputs.items.map(outputMaintenanceItem),
    },
  ];
}
