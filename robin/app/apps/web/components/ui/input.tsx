import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Quiet Slate input: a form field is the one place a 1px border survives, so it
 * keeps its boundary - drawn in `--line-strong` (via the shadcn `input` token)
 * because a field edge has to clear the 3:1 non-text contrast bar that a 12%
 * `--line` rule cannot - plus a soft `--radius-sm`. No shadow (border OR
 * shadow, never both). Colours via tokens only; focus ring handled globally by
 * primitives.css.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-background px-3 py-1 text-base outline-none transition-colors selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
