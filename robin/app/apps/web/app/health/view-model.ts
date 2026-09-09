import type {
  HealthMetric,
  HealthSection,
  HealthStatus,
  MaintenanceItem,
  MaintenanceSnapshot,
} from '@/lib/maintenance';
import type { CatalogPage, OutputItem } from '@/lib/catalog';
import { vaultFileHref } from '@/lib/routes';
import type { HealthBaseline } from './snapshot-store';
import type {
  HActionKind,
  HFooterLayer,
  HItemVM,
  HMetricVM,
  HSectionVM,
  HStatus,
  HStripVM,
  HealthViewModel,
} from './health-types';

// ── small formatters ────────────────────────────────────────────────────────

const MINUS = '−'; // − true minus, matches the wireframe

function toNum(value: string | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function deltaText(current: number | null, previous: number | undefined): string | undefined {
  if (current === null || previous === undefined) return undefined;
  const diff = current - previous;
  if (diff === 0) return undefined;
  return diff < 0 ? `(${MINUS}${Math.abs(diff)})` : `(+${diff})`;
}

function verdictWord(status: HStatus): string {
  return status === 'critical' ? 'critical' : status === 'warn' ? 'attention' : 'healthy';
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function formatStamp(date: Date): string {
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .toLowerCase();
}

function cachedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'just now';
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

// ── per-scanner config ───────────────────────────────────────────────────────

const SHORT_TITLE: Record<string, string> = {
  'index-health': 'Index & engine',
  integrity: 'Integrity',
  decay: 'Decay',
  memory: 'Memory',
  composition: 'Composition',
  cadence: 'Cadence',
  outputs: 'Outputs',
};

function getMetric(section: HealthSection, label: string): HealthMetric | undefined {
  return section.metrics.find((m) => m.label === label);
}

function sumMetrics(section: HealthSection, labels: string[]): number {
  return labels.reduce((acc, label) => {
    const n = toNum(getMetric(section, label)?.value ?? '');
    return acc + (n ?? 0);
  }, 0);
}

/** The one metric a scanner shows in its status-strip tile. */
function topMetric(
  section: HealthSection,
  prev: Record<string, number> | undefined,
): { text: string; delta?: string } {
  if (section.status === 'critical' && section.metrics.length === 0) {
    return { text: 'failed' };
  }
  const num = (label: string) => toNum(getMetric(section, label)?.value ?? '');
  switch (section.id) {
    case 'index-health': {
      const freshness = getMetric(section, 'Index freshness')?.value;
      return { text: String(freshness ?? '—') };
    }
    case 'integrity': {
      const v = num('Broken wikilinks');
      return { text: `links ${v ?? '—'}`, delta: deltaText(v, prev?.['Broken wikilinks']) };
    }
    case 'decay': {
      const v = num('Stale pages');
      return { text: `stale ${v ?? '—'}`, delta: deltaText(v, prev?.['Stale pages']) };
    }
    case 'memory': {
      const v = sumMetrics(section, ['Malformed events', 'Tentative', 'Rejected', 'Superseded']);
      const prevSum =
        prev === undefined
          ? undefined
          : (prev['Malformed events'] ?? 0) +
            (prev['Tentative'] ?? 0) +
            (prev['Rejected'] ?? 0) +
            (prev['Superseded'] ?? 0);
      return { text: `flagged ${v}`, delta: deltaText(v, prevSum) };
    }
    case 'composition': {
      const v = num('Total pages');
      return { text: `${v ?? '—'} pages` };
    }
    case 'cadence': {
      const v = num('Open annotations');
      return { text: `annos ${v ?? '—'}`, delta: deltaText(v, prev?.['Open annotations']) };
    }
    case 'outputs': {
      const v = num('Archive candidates');
      return { text: `archive ${v ?? '—'}`, delta: deltaText(v, prev?.['Archive candidates']) };
    }
    default:
      return { text: section.status === 'ok' ? 'ok' : 'attention' };
  }
}

/** Best-known total M for the "showing N of M" contract. */
function itemsTotal(section: HealthSection): number {
  const num = (label: string) => toNum(getMetric(section, label)?.value ?? '') ?? 0;
  let total = section.items.length;
  switch (section.id) {
    case 'integrity':
      total =
        num('Broken wikilinks') +
        num('Orphan pages') +
        num('Meta issues') +
        num('Ambiguous slugs') +
        num('Task integrity');
      break;
    case 'decay':
      total = num('Stale pages');
      break;
    case 'memory':
      total = sumMetrics(section, ['Malformed events', 'Tentative', 'Rejected', 'Superseded']);
      break;
    case 'cadence':
      total = num('Open annotations');
      break;
    case 'outputs':
      total = num('Archive candidates') + num('Root-level files') + num('Large files');
      break;
  }
  return Math.max(total, section.items.length);
}

// ── item view-model ──────────────────────────────────────────────────────────

const ANN_PREFIX = 'annotation:';

function buildItem(section: HealthSection, item: MaintenanceItem): HItemVM {
  const external = item.href ? !item.href.startsWith('/') : false;
  let openHref: string | undefined = item.href ?? (item.path ? vaultFileHref(item.path) : undefined);
  let openLabel = 'Open';
  let action: HActionKind = 'open';
  let annId: string | undefined;
  let annPagePath: string | undefined;
  let archivePath: string | undefined;

  if (section.id === 'memory') {
    openHref = '/memory';
    openLabel = 'Open in memory';
  }

  if (section.id === 'cadence' && item.id.startsWith(ANN_PREFIX)) {
    action = 'annotation';
    annId = item.id.slice(ANN_PREFIX.length);
    annPagePath = item.path;
  } else if (section.id === 'outputs' && item.path && /^out\/[^/]+\/.+/.test(item.path)) {
    // Only nested out/ files are archive candidates; a root-level file just gets Open.
    action = 'archive';
    archivePath = item.path;
  }

  return {
    id: item.id,
    scannerId: section.id,
    title: item.title,
    detail: item.detail,
    path: item.path,
    meta: item.meta ?? [],
    severity: item.severity,
    action,
    openHref,
    openLabel,
    external: action === 'open' ? external : false,
    annId,
    annPagePath,
    archivePath,
  };
}

// ── metric view-model ────────────────────────────────────────────────────────

function buildMetric(
  section: HealthSection,
  metric: HealthMetric,
  prev: Record<string, number> | undefined,
): HMetricVM {
  const num = toNum(metric.value);
  const delta = deltaText(num, prev?.[metric.label]);
  // The freshness hint on index-health names the newest brain file as a link.
  let hintHref: string | undefined;
  if (section.id === 'index-health' && metric.label === 'Index freshness' && metric.hint) {
    const match = metric.hint.match(/([\w./-]+\.html)/);
    if (match && match[1]) hintHref = vaultFileHref(match[1]);
  }
  return {
    label: metric.label,
    value: String(metric.value),
    status: metric.status ?? 'ok',
    hint: metric.hint,
    hintHref,
    delta,
  };
}

// ── composition reconstruction (flattened section → table rows) ──────────────

function compositionRows(section: HealthSection): {
  byType: { label: string; count: number }[];
  byTier: { label: string; count: number }[];
  pages: number;
  links: number;
} {
  const byType = section.metrics
    .filter((m) => m.label.startsWith('Type: '))
    .map((m) => ({ label: m.label.replace('Type: ', ''), count: toNum(m.value) ?? 0 }));
  const byTier = section.items.map((item) => ({
    label: item.title,
    count: toNum((item.detail ?? '').replace(/[^\d]/g, '')) ?? 0,
  }));
  return {
    byType,
    byTier,
    pages: toNum(getMetric(section, 'Total pages')?.value ?? '') ?? 0,
    links: toNum(getMetric(section, 'Total links')?.value ?? '') ?? 0,
  };
}

// ── footer layers ────────────────────────────────────────────────────────────

function newestPage(pages: CatalogPage[], predicate?: (p: CatalogPage) => boolean): CatalogPage | undefined {
  const pool = predicate ? pages.filter(predicate) : pages;
  return pool.reduce<CatalogPage | undefined>((best, p) => (!best || p.mtime > best.mtime ? p : best), undefined);
}

function buildFooterLayers(
  snapshot: MaintenanceSnapshot,
  brainPages: CatalogPage[],
  outputs: OutputItem[],
): HFooterLayer[] {
  const memorySection = snapshot.sections.find((s) => s.id === 'memory');
  const cadenceSection = snapshot.sections.find((s) => s.id === 'cadence');
  const totalEvents = memorySection
    ? String(getMetric(memorySection, 'Total events')?.value ?? '—')
    : '—';
  const changelogHint = cadenceSection
    ? getMetric(cadenceSection, 'Changelog')?.hint ?? '—'
    : '—';

  const taskPages = brainPages.filter((p) => p.type === 'task');
  const decisionPages = brainPages.filter((p) => p.type === 'decision');
  const newestBrain = newestPage(brainPages);
  const newestTask = newestPage(taskPages);
  const newestDecision = newestPage(decisionPages);
  const newestOutput = outputs.reduce<OutputItem | undefined>(
    (best, o) => (!best || o.mtime > best.mtime ? o : best),
    undefined,
  );

  return [
    {
      layer: 'inbox/',
      what: 'immutable sources',
      count: '—',
      surfaceHref: '/activity',
      surfaceLabel: '/activity',
      lastWrite: '—',
    },
    {
      layer: 'brain/',
      what: 'durable HTML',
      count: String(brainPages.length),
      surfaceHref: '/vault',
      surfaceLabel: '/vault',
      lastWrite: newestBrain
        ? `${formatStamp(newestBrain.mtime)} · ${newestBrain.path.split('/').pop()}`
        : '—',
    },
    {
      layer: '├ tasks',
      what: 'task pages',
      count: String(taskPages.length),
      surfaceHref: '/tasks',
      surfaceLabel: '/tasks',
      lastWrite: newestTask ? formatStamp(newestTask.mtime) : '—',
      sub: true,
    },
    {
      layer: '├ decisions',
      what: 'decision records',
      count: String(decisionPages.length),
      surfaceHref: '/vault',
      surfaceLabel: '/vault',
      lastWrite: newestDecision ? formatStamp(newestDecision.mtime) : '—',
      sub: true,
    },
    {
      layer: 'memory/',
      what: 'recall ledger (events.jsonl)',
      count: totalEvents,
      surfaceHref: '/memory',
      surfaceLabel: '/memory',
      lastWrite: '—',
    },
    {
      layer: 'out/',
      what: 'artifacts — briefs, reports, decks',
      count: String(outputs.length),
      surfaceHref: '/outputs',
      surfaceLabel: '/outputs',
      lastWrite: newestOutput ? formatStamp(newestOutput.mtime) : '—',
    },
    {
      layer: 'logs/',
      what: 'operational append-only logs',
      count: 'append-only',
      surfaceHref: '/activity',
      surfaceLabel: '/activity',
      lastWrite: changelogHint,
    },
  ];
}

// ── main builder ─────────────────────────────────────────────────────────────

export interface BuildInputs {
  snapshot: MaintenanceSnapshot;
  baseline: HealthBaseline | null;
  brainPages: CatalogPage[];
  outputs: OutputItem[];
  ownerPoss: string;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

export function buildHealthViewModel(inputs: BuildInputs): HealthViewModel {
  const { snapshot, baseline, brainPages, outputs, ownerPoss } = inputs;
  const prevMetrics = baseline?.metrics ?? {};
  const hasBaseline = baseline !== null;

  const sections: HSectionVM[] = snapshot.sections.map((section, i) => {
    const prev = prevMetrics[section.id];
    const items = section.items.map((item) => buildItem(section, item));
    const isComposition = section.id === 'composition';

    let criticalCard: { title: string; body: string } | null = null;
    if (section.id === 'index-health' && section.status === 'critical') {
      criticalCard = {
        title: 'Index engine outage',
        body: section.summary,
      };
    }

    // Cadence provenance rows (the richer edit-log stream, BUILD-BRIEF §7.6)
    // need the snapshot to carry the events; omitted until it does.
    const provRows: HSectionVM['provRows'] = undefined;
    const base: HSectionVM = {
      id: section.id,
      num: i + 1,
      title: section.title,
      status: section.status,
      source: section.source,
      summary: section.summary,
      metrics: isComposition ? [] : section.metrics.map((m) => buildMetric(section, m, prev)),
      items,
      itemsLabel: section.itemsLabel ?? 'Items',
      itemsTotal: itemsTotal(section),
      criticalCard,
      provRows,
    };

    if (isComposition) {
      const c = compositionRows(section);
      base.isComposition = true;
      base.compByType = c.byType;
      base.compByTier = c.byTier;
      base.compPages = c.pages;
      base.compLinks = c.links;
      base.items = [];
    }

    return base;
  });

  const strip: HStripVM[] = snapshot.sections.map((section) => {
    const top = topMetric(section, prevMetrics[section.id]);
    return {
      id: section.id,
      title: SHORT_TITLE[section.id] ?? section.title,
      status: section.status,
      metric: top.text,
      delta: top.delta,
    };
  });

  // Triage: every critical+warning item across all scanners, ranked.
  const triage: HItemVM[] = sections
    .flatMap((s) => s.items)
    .filter((item) => item.severity === 'critical' || item.severity === 'warning')
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));

  const { ok, warn, critical } = snapshot.statusCounts;
  const countsLine = `${critical} critical · ${warn} attention · ${ok} healthy · across ${snapshot.sections.length} scanners`;

  let worst: string | null = null;
  if (snapshot.overall === 'critical') {
    const worstSection = snapshot.sections.find((s) => s.status === 'critical');
    if (worstSection) worst = `worst: ${worstSection.title.toLowerCase()} — ${worstSection.summary}`;
  }

  return {
    generatedAt: snapshot.generatedAt,
    generatedLabel: `snapshot ${formatClock(snapshot.generatedAt)}`,
    cachedLabel: cachedLabel(snapshot.generatedAt),
    scannerCount: snapshot.sections.length,
    overall: snapshot.overall,
    verdictWord: verdictWord(snapshot.overall),
    counts: { ok, warn, critical },
    countsLine,
    worst,
    hasBaseline,
    strip,
    triage,
    triageTotal: triage.length,
    sections,
    footer: {
      ownerPoss,
      layers: buildFooterLayers(snapshot, brainPages, outputs),
    },
  };
}
