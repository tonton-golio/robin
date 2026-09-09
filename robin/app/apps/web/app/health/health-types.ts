// View-model types shared between the health server component (which builds
// them from the MaintenanceSnapshot) and the client dashboard (which renders +
// makes them interactive). Types only — safe to import from a client module.

export type HStatus = 'ok' | 'warn' | 'critical';
export type HSeverity = 'critical' | 'warning' | 'info';

/** Inline triage/section action attached to an item, derived from its home scanner. */
export type HActionKind = 'open' | 'archive' | 'annotation';

export interface HMetricVM {
  label: string;
  value: string;
  status: HStatus;
  hint?: string;
  hintHref?: string;
  /** Day-over-day delta text, e.g. "(−3)" / "(+2)". Absent when unchanged / no baseline. */
  delta?: string;
}

export interface HItemVM {
  id: string;
  scannerId: string;
  title: string;
  detail?: string;
  path?: string;
  meta: string[];
  severity: HSeverity;
  action: HActionKind;
  /** Open target (file reader or in-app surface). */
  openHref?: string;
  openLabel: string;
  external: boolean;
  /** annotation action */
  annId?: string;
  annPagePath?: string;
  /** archive action — vault-relative out/ path */
  archivePath?: string;
}

export interface HProvRow {
  who: string;
  robin: boolean;
  when: string;
  what: string;
  href?: string;
}

export interface HCompositionRow {
  label: string;
  count: number;
}

export interface HSectionVM {
  id: string;
  num: number;
  title: string;
  status: HStatus;
  source?: string;
  summary: string;
  metrics: HMetricVM[];
  items: HItemVM[];
  itemsLabel: string;
  /** Best-known total M for the honest "showing N of M" contract. */
  itemsTotal: number;
  /** composition renders as a demoted mono table instead of tiles. */
  isComposition?: boolean;
  compByType?: HCompositionRow[];
  compByTier?: HCompositionRow[];
  compPages?: number;
  compLinks?: number;
  /** index-engine critical outage card (db missing etc.). */
  criticalCard?: { title: string; body: string } | null;
  /** cadence recent edit-log provenance rows. */
  provRows?: HProvRow[];
  provLabel?: string;
}

export interface HStripVM {
  id: string;
  title: string;
  status: HStatus;
  metric: string;
  delta?: string;
}

export interface HFooterLayer {
  layer: string;
  what: string;
  count: string;
  surfaceHref: string;
  surfaceLabel: string;
  lastWrite: string;
  sub?: boolean;
}

export interface HealthViewModel {
  generatedAt: string;
  generatedLabel: string;
  cachedLabel: string;
  scannerCount: number;
  overall: HStatus;
  verdictWord: string;
  counts: { ok: number; warn: number; critical: number };
  countsLine: string;
  worst?: string | null;
  hasBaseline: boolean;
  strip: HStripVM[];
  triage: HItemVM[];
  triageTotal: number;
  sections: HSectionVM[];
  footer: {
    ownerPoss: string;
    layers: HFooterLayer[];
  };
}
