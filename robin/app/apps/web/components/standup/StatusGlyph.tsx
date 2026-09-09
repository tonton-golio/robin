'use client';

import { Circle, CircleDot, CheckCircle2, AlertOctagon, Pause } from 'lucide-react';
import { normalizeStatus } from '@/lib/task-display';

/**
 * The honest three-state status glyph (plus blocked/archived). In-progress is
 * the only one carrying the accent — the rationed `--blue`; done/blocked use the
 * semantic health tokens, and open/archived sit at `--muted` (solid: these are
 * non-text marks and must clear 3:1). Clicking it cycles status, mirroring the
 * `x` keystroke.
 */
export function StatusGlyph({
  status,
  size = 15,
  onClick,
}: {
  status: string | undefined;
  size?: number;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const s = normalizeStatus(status);
  const common = { size, strokeWidth: 1.6 } as const;
  let icon = <Circle {...common} style={{ color: 'var(--muted)' }} />;
  let label = 'open';
  if (s === 'in-progress') {
    icon = <CircleDot {...common} style={{ color: 'var(--blue)' }} />;
    label = 'in progress';
  } else if (s === 'done') {
    icon = <CheckCircle2 {...common} style={{ color: 'var(--good)' }} />;
    label = 'done';
  } else if (s === 'blocked') {
    icon = <AlertOctagon {...common} style={{ color: 'var(--red)' }} />;
    label = 'blocked';
  } else if (s === 'archived') {
    icon = <Pause {...common} style={{ color: 'var(--muted)' }} />;
    label = 'archived';
  }

  if (!onClick) {
    return (
      <span className="inline-flex" title={label} aria-label={label}>
        {icon}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} — click to advance`}
      aria-label={`status ${label}, advance`}
      className="inline-flex shrink-0 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)]"
    >
      {icon}
    </button>
  );
}
