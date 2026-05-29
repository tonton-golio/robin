export type Severity = 'info' | 'warning' | 'critical';

export interface MaintenanceCounts {
  openAnnotations: number;
  stalePages: number;
  lintIssues: number;
  taskIssues: number;
  memoryIssues: number;
  outputIssues: number;
  totalIssues: number;
  brokenWikilinks: number;
  orphanPages: number;
  metaIssues: number;
  openTasks: number;
  overdueTasks: number;
  memoryMalformedEvents: number;
  memoryTentative: number;
  memoryRejected: number;
  memorySuperseded: number;
  outputArchiveCandidates: number;
}

export interface MaintenanceSnapshot {
  generatedAt: string;
  counts: MaintenanceCounts;
  sections: MaintenanceSection[];
}

export interface MaintenanceSection {
  id: string;
  title: string;
  summary: string;
  severity: Severity;
  count: number;
  items: MaintenanceItem[];
}

export interface MaintenanceItem {
  id: string;
  title: string;
  detail?: string;
  path?: string;
  href?: string;
  meta?: string[];
  severity: Severity;
}
