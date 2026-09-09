// Barrel for the maintenance scanners that back the /maintenance page.
//
// The implementation is split by concern under lib/maintenance/* (one file per
// section scanner plus shared types and helpers). This module re-exports the
// same public surface so existing importers (app/maintenance/page.tsx,
// app/api/maintenance/route.ts, lib/catalog.ts) keep working unchanged.

// Core snapshot shape + the orchestrator that assembles it.
export type {
  HealthStatus,
  HealthMetric,
  HealthSection,
  HealthStripEntry,
  MaintenanceSnapshot,
  MaintenanceItem,
} from './maintenance/types';
export { getMaintenanceSnapshot } from './maintenance/snapshot';

// Section: open annotations.
export type { AnnotationSection, OpenAnnotation } from './maintenance/annotations';

// Section: stale pages (from the index db).
export type { StalePagesSection, StalePage } from './maintenance/stale-pages';

// Section: wiki integrity (broken wikilinks, orphans, meta issues).
export type { WikiSection, WikiLinkIssue, OrphanPage, MetaIssue } from './maintenance/wiki';

// Section: task integrity (non-deadline signals only; deadlines live in /tasks).
export type { TaskIntegritySection, TaskIssue } from './maintenance/tasks';

// Section: memory health.
export type { MemoryHealthSection, MemoryIssue } from './maintenance/memory';

// Section: output hygiene.
export type { OutputHygieneSection, OutputIssue } from './maintenance/outputs';

// Section: index & engine health (index.db freshness + reindex stats).
export type { IndexHealthSection } from './maintenance/index-health';

// Section: vault composition (by_type / by_tier / links from index.db).
export type { CompositionSection } from './maintenance/composition';

// Section: operational cadence (log recency + edit-log volume).
export type { CadenceSection, LogCadence } from './maintenance/cadence';

// Wikilink extraction helper (consumed by lib/catalog.ts).
export { linksFromBlocks } from './maintenance/links';
