import type { ReactNode } from 'react';

/** Mono section heading with an optional right-aligned count/affordance. */
export function SectionHeading({ title, icon, aside }: { title: ReactNode; icon?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3.5 flex items-center justify-between gap-3 border-b border-border pb-2.5">
      <h2 className="m-0 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </h2>
      {aside != null ? <span className="font-mono text-[11px] text-muted-foreground">{aside}</span> : null}
    </div>
  );
}
