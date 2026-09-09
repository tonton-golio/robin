'use client';

import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Tone } from '@/lib/task-display';

/**
 * Tone → a thin baseline swatch under the column header.
 *
 * Quiet Slate v2: tokens only. The old accent tones (amber/cyan/violet) collapse
 * onto the single accent `--blue`, exactly as DayRail/WeekStrip/Pill already do;
 * rust -> `--red`, green -> `--good`, neutral -> `--muted`. No alpha modifiers: a
 * 1px swatch needs full strength to clear the 3:1 non-text contrast bar. Every
 * entry is a complete literal class string; Tailwind v4 emits nothing it cannot
 * see, so these must never be built by interpolation.
 */
const TONE_BASE: Record<Tone, string> = {
  neutral: 'bg-[var(--muted)]',
  amber: 'bg-[var(--blue)]',
  cyan: 'bg-[var(--blue)]',
  violet: 'bg-[var(--blue)]',
  rust: 'bg-[var(--red)]',
  green: 'bg-[var(--good)]',
};

/**
 * Column shell states, as whole literal class strings so exactly one background
 * utility is ever applied (mixing two `bg-[…]` arbitrary values would leave the
 * winner up to stylesheet order). A dimmed column recedes to the app ground
 * instead of being faded - text is never tiered with opacity (spec section 10a).
 */
const SHELL_BASE = 'rounded-[var(--radius-lg)] border p-2 transition-colors';
const SHELL_ARMED = 'border-[var(--blue)] bg-[color-mix(in_srgb,var(--blue)_6%,var(--card))]';
const SHELL_DIMMED = 'border-[var(--line)] bg-[var(--paper)]';
const SHELL_IDLE = 'border-[var(--line)] bg-[var(--card)]';

/**
 * A status column: a level-1 surface with a mono header, count, and a tone
 * baseline. Doubles as a pointer drop target — dropping a dragged task here sets
 * its robin:status. The Done column is collapsible (and recedes to the app
 * ground) so finished work doesn't crowd the live board.
 */
export function StatusColumn({
  status,
  label,
  count,
  tone,
  dropArmed,
  dimmed,
  collapsible,
  collapsed,
  onToggleCollapse,
  children,
}: {
  status: string;
  label: string;
  count: number;
  tone: Tone;
  dropArmed: boolean;
  dimmed?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  children: ReactNode;
}) {
  const listId = `status-col-${status}`;
  const headerInner = (
    <>
      <h3 className="m-0 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
        {label}
      </h3>
      <span className="font-mono text-[11px] tabular-nums text-[var(--muted)]">{count}</span>
      <span className="ml-auto flex items-center gap-2">
        {collapsible ? (
          <ChevronDown
            size={13}
            strokeWidth={1.6}
            className={['text-[var(--muted)] transition-transform', collapsed ? '-rotate-90' : ''].join(' ')}
            aria-hidden
          />
        ) : null}
        <span className={['h-px w-8', TONE_BASE[tone]].join(' ')} aria-hidden />
      </span>
    </>
  );

  return (
    <section
      data-drop-status={status}
      className={[
        SHELL_BASE,
        dropArmed ? SHELL_ARMED : dimmed ? SHELL_DIMMED : SHELL_IDLE,
      ].join(' ')}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-controls={listId}
          aria-label={`${label}, ${collapsed ? 'show' : 'hide'} ${count} done`}
          className="mb-1.5 flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border-b border-[var(--hairline)] pb-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)]"
        >
          {headerInner}
        </button>
      ) : (
        <div className="mb-1.5 flex items-center gap-2 border-b border-[var(--hairline)] pb-1.5">{headerInner}</div>
      )}
      <ul id={listId} hidden={collapsed} className="m-0 list-none space-y-0.5 p-0">
        {children}
      </ul>
    </section>
  );
}
