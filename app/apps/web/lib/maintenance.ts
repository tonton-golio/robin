// Barrel for the maintenance scanners that back the /maintenance page.
//
// The implementation is split by concern under lib/maintenance/* (one file per
// section scanner plus shared types and helpers). This module re-exports the
// same public surface so existing importers (app/maintenance/page.tsx,
// app/api/maintenance/route.ts, lib/catalog.ts) keep working unchanged.

// Core snapshot shape + the orchestrator that assembles it.
export type {
  MaintenanceCounts,
  MaintenanceSnapshot,
  MaintenanceSection,
  MaintenanceItem,
} from './maintenance/types';
export { getMaintenanceSnapshot } from './maintenance/snapshot';

// Section: open annotations.
export type { AnnotationSection, OpenAnnotation } from './maintenance/annotations';

// Section: stale pages (from the index db).
export type { StalePagesSection, StalePage } from './maintenance/stale-pages';

// Section: wiki integrity (broken wikilinks, orphans, meta issues).
export type { WikiSection, WikiLinkIssue, OrphanPage, MetaIssue } from './maintenance/wiki';

// Section: task hygiene.
export type { TaskHygieneSection, TaskIssue } from './maintenance/tasks';

// Section: memory health.
export type { MemoryHealthSection, MemoryIssue } from './maintenance/memory';

// Section: output hygiene.
export type { OutputHygieneSection, OutputIssue } from './maintenance/outputs';

// Wikilink extraction helper (consumed by lib/catalog.ts).
export { linksFromBlocks } from './maintenance/links';
