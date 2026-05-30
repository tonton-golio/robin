import type { ReactNode } from 'react';

/** Centered empty/zero state inside a dashed surface. */
export function EmptyState({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-1.5 rounded-[var(--radius-lg)] border border-dashed border-border px-6 py-12 text-center text-muted-foreground">
      <strong className="text-sm font-medium text-foreground/90">{title}</strong>
      {hint ? <span className="max-w-[52ch] text-[13px]">{hint}</span> : null}
    </div>
  );
}

/** Inline error banner (destructive / rust). */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[13px] text-[#f0b49b]">
      {children}
    </div>
  );
}
