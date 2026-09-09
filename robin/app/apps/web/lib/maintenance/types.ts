export type Severity = 'info' | 'warning' | 'critical';

// Health status for the system-health dashboard. Ordered ok < warn < critical.
export type HealthStatus = 'ok' | 'warn' | 'critical';

// A single summary metric shown as a KPI tile inside a section.
export interface HealthMetric {
  label: string;
  value: string | number;
  status?: HealthStatus;
  hint?: string;
}

// One dashboard section: an at-a-glance status, a set of summary metrics, and
// an optional expandable detail list (top stale pages, integrity issues, ...).
export interface HealthSection {
  id: string;
  title: string;
  status: HealthStatus;
  summary: string;
  source?: string;
  metrics: HealthMetric[];
  itemsLabel?: string;
  items: MaintenanceItem[];
}

// Compact per-section entry rendered in the top status strip.
export interface HealthStripEntry {
  id: string;
  title: string;
  status: HealthStatus;
  headline: string;
}

export interface MaintenanceSnapshot {
  generatedAt: string;
  overall: HealthStatus;
  statusCounts: Record<HealthStatus, number>;
  strip: HealthStripEntry[];
  sections: HealthSection[];
}

// Detail-row shape reused by every scanner's *Item mapper.
export interface MaintenanceItem {
  id: string;
  title: string;
  detail?: string;
  path?: string;
  href?: string;
  meta?: string[];
  severity: Severity;
}
