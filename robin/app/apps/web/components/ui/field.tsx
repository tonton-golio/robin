import type { ReactNode } from 'react';
import { Label } from './label';

/** Labelled form field: mono uppercase label above its control. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
        {hint ? <span className="ml-1 normal-case tracking-normal opacity-70">{hint}</span> : null}
      </Label>
      {children}
    </div>
  );
}
