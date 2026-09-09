import type { ReactNode } from 'react';

/** Centered empty/zero state inside a dashed surface. */
export function EmptyState({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-1.5 border border-dashed border-border px-6 py-12 text-center text-muted-foreground">
      <strong className="text-sm font-medium text-foreground/90">{title}</strong>
      {hint ? <span className="max-w-[52ch] text-[13px]">{hint}</span> : null}
    </div>
  );
}

/**
 * Inline error banner. Poster treatment: square, red 1px border + a faint red
 * wash, red ink. Colors via tokens only (no hardcoded literals).
 */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="border border-[var(--red)] bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-3 py-2.5 text-[13px] text-[var(--red)]">
      {children}
    </div>
  );
}
