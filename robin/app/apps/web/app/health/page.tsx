import type { Metadata } from 'next';
import { getMaintenanceSnapshot } from '@/lib/maintenance';
import { listBrainPages, listOutputs } from '@/lib/catalog';
import { ownerPossessive } from '@/lib/config';
import { readBaseline, writeBaseline } from './snapshot-store';
import { buildHealthViewModel } from './view-model';
import { HealthDashboard } from './HealthDashboard';

export const metadata: Metadata = {
  title: 'Health · Robin',
};

// Cached-snapshot model (BUILD-BRIEF §7): render the freshly-computed snapshot
// immediately; Rescan recomputes + re-diffs. force-dynamic so a plain load and
// the agent's /api/maintenance read never drift.
export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  const [snapshot, baseline, brainPages, outputs] = await Promise.all([
    getMaintenanceSnapshot({ limit: 50 }),
    readBaseline(),
    listBrainPages(),
    listOutputs(),
  ]);

  // Seed the delta baseline on first-ever load so subsequent loads / rescans
  // can render day-over-day deltas. No-op (and never fatal) if it fails.
  if (!baseline) {
    await writeBaseline(snapshot);
  }

  const vm = buildHealthViewModel({
    snapshot,
    baseline,
    brainPages,
    outputs,
    ownerPoss: ownerPossessive(),
  });

  return <HealthDashboard vm={vm} />;
}
