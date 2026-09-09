import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'amber' | 'cyan' | 'violet' | 'rust' | 'green' | 'waiting' | 'blocked';

/**
 * Status pill - the utility-form twin of `.r-pill` in styles/primitives.css.
 * Quiet Slate v2: 999px radius, an 11px `--lab-*` micro-label, a 1px `--line`
 * outline and wash-not-fill states (a pill is never a solid colour field).
 * `primitives.css` is the reference if the two ever drift.
 *
 * Colours come from tokens only. The old accent tones (amber/cyan/violet)
 * collapse onto the single accent, and its label uses `--blue-deep`: on the
 * light 10% wash over `--paper`, `--blue` is 4.44:1 while `--blue-deep` is
 * 5.61:1 (spec section 9). rust -> red (overdue/alarm), green -> good. Tone
 * names are kept so existing call sites don't break, and `waiting` / `blocked`
 * mirror `.r-pill[data-status="waiting"|"blocked"]` (transparent + `--ink`, the
 * blocked one marked by a dashed outline rather than a fill).
 *
 * Every entry is a complete literal class string - Tailwind v4 only emits
 * classes it can see, so these must never be built by interpolation.
 */
const TONES: Record<Tone, string> = {
  neutral: 'border-[var(--line)] bg-transparent text-[var(--muted)]',
  amber:
    'border-[color-mix(in_srgb,var(--blue)_40%,transparent)] bg-[var(--accent-wash)] text-[var(--blue-deep)]',
  cyan: 'border-[color-mix(in_srgb,var(--blue)_40%,transparent)] bg-[var(--accent-wash)] text-[var(--blue-deep)]',
  violet:
    'border-[color-mix(in_srgb,var(--blue)_40%,transparent)] bg-[var(--accent-wash)] text-[var(--blue-deep)]',
  rust: 'border-[color-mix(in_srgb,var(--red)_40%,transparent)] bg-[var(--red-wash)] text-[var(--red)]',
  green:
    'border-[color-mix(in_srgb,var(--good)_40%,transparent)] bg-[color-mix(in_srgb,var(--good)_12%,transparent)] text-[var(--good)]',
  waiting: 'border-[var(--line)] bg-transparent text-[var(--ink)]',
  blocked: 'border-[var(--line)] border-dashed bg-transparent text-[var(--ink)]',
};

/** Small uppercase micro-label tag for status/type/meta. */
export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border px-[9px] py-[3px]',
        'text-[length:var(--lab-size)] font-semibold [text-transform:var(--lab-case)] tracking-[var(--lab-track)]',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
