import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  /** Smaller title for utility pages (e.g. forms). */
  compact?: boolean;
}

/** Standard page header: amber mono eyebrow, serif title, optional sub + actions. */
export function PageHeader({ eyebrow, title, sub, actions, compact }: PageHeaderProps) {
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-5">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-primary">{eyebrow}</p>
        ) : null}
        <h1
          className={cn('m-0 font-normal tracking-tight text-foreground', compact ? 'text-2xl' : 'text-3xl sm:text-4xl')}
          style={{ fontFamily: 'var(--font-serif)', lineHeight: 1.1 }}
        >
          {title}
        </h1>
        {sub ? <p className="mt-2.5 max-w-[66ch] text-sm leading-relaxed text-muted-foreground">{sub}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
