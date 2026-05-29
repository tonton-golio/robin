import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'amber' | 'cyan' | 'violet' | 'rust' | 'green';

const TONES: Record<Tone, string> = {
  neutral: 'border-border bg-secondary text-muted-foreground',
  amber: 'border-[rgba(232,161,60,0.35)] bg-[rgba(232,161,60,0.10)] text-[var(--robin-amber)]',
  cyan: 'border-[rgba(94,200,206,0.30)] bg-[rgba(94,200,206,0.10)] text-[var(--signal-cyan)]',
  violet: 'border-[rgba(167,139,250,0.30)] bg-[rgba(167,139,250,0.10)] text-[var(--decision-violet)]',
  rust: 'border-[rgba(217,119,87,0.35)] bg-[rgba(217,119,87,0.10)] text-[var(--warning-rust)]',
  green: 'border-[rgba(107,163,104,0.35)] bg-[rgba(107,163,104,0.10)] text-[var(--status-stable)]',
};

/** Small uppercase mono tag for status/type/meta. */
export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase leading-tight tracking-wide',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
