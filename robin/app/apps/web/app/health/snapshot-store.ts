import path from 'path';
import { promises as fs } from 'fs';
import { durableReplace, withVaultLocks } from '@robin/vault-io';
import { locateVault } from '@/lib/vault';
import type { MaintenanceSnapshot } from '@/lib/maintenance';

/**
 * Cross-session delta baseline for /health. The page diffs the live snapshot
 * against the last persisted one so day-over-day deltas render without a second
 * `/api/maintenance` call. Persisted as a gitignored sidecar under `.robin/`.
 *
 * This is deliberately confined to the health page's own directory — it does
 * NOT change the shared MaintenanceSnapshot contract. If the snapshot ever
 * carries per-metric deltas itself (see BUILD-BRIEF §12), this becomes dead
 * code and can be deleted.
 */

export interface HealthBaseline {
  generatedAt: string;
  /** sectionId -> (metric label -> numeric value) */
  metrics: Record<string, Record<string, number>>;
}

function baselinePath(): string {
  return path.join(locateVault(), '.robin', 'health-baseline.json');
}

function toNumeric(value: string | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Flatten a snapshot into the numeric-metric map we diff against. */
export function metricsMapFromSnapshot(snapshot: MaintenanceSnapshot): HealthBaseline['metrics'] {
  const map: HealthBaseline['metrics'] = {};
  for (const section of snapshot.sections) {
    const row: Record<string, number> = {};
    for (const metric of section.metrics) {
      const n = toNumeric(metric.value);
      if (n !== null) row[metric.label] = n;
    }
    map[section.id] = row;
  }
  return map;
}

export async function readBaseline(): Promise<HealthBaseline | null> {
  try {
    const raw = await fs.readFile(baselinePath(), 'utf8');
    const parsed = JSON.parse(raw) as HealthBaseline;
    if (parsed && typeof parsed === 'object' && parsed.metrics) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function writeBaseline(snapshot: MaintenanceSnapshot): Promise<void> {
  try {
    const dir = path.dirname(baselinePath());
    await fs.mkdir(dir, { recursive: true });
    const payload: HealthBaseline = {
      generatedAt: snapshot.generatedAt,
      metrics: metricsMapFromSnapshot(snapshot),
    };
    const vault = locateVault();
    await withVaultLocks(vault, ['sidecar:health-baseline'], () =>
      durableReplace(baselinePath(), JSON.stringify(payload))
    );
  } catch {
    // A missing baseline just means deltas are blank next render — never fatal.
  }
}
