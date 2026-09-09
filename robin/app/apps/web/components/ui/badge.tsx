import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Badge - the utility-form twin of `.r-pill` in styles/primitives.css.
 * Quiet Slate v2: 999px radius (`rounded-full`), an 11px `--lab-*` micro-label
 * at weight 600, a 1px outline and wash-not-fill states. `primitives.css` is
 * the reference if the two ever drift.
 *
 * Colours are tokens only; no raw Tailwind palette. The former "ink brick"
 * (`ink`) is now the marked state: accent wash + ink label. Like `.r-pill`,
 * every variant draws the 1px outline - including `ghost` and `link`, which are
 * outlined pills and not bare text - and `blocked` is marked by a dashed
 * outline rather than a fill. The label case and tracking read the shared
 * `--lab-*` tokens so the twin cannot drift when those are retuned. Variant
 * names are unchanged so call sites keep working. Focus ring handled globally
 * by primitives.css.
 *
 * Each variant is a complete literal class string - Tailwind v4 emits nothing
 * it cannot see, so never build these by interpolation.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-[5px] overflow-hidden rounded-full border border-transparent px-[9px] py-[3px] text-[length:var(--lab-size)] font-semibold [text-transform:var(--lab-case)] tracking-[var(--lab-track)] whitespace-nowrap transition-colors [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--accent-wash)] text-[var(--blue-deep)] border-[color-mix(in_srgb,var(--blue)_40%,transparent)]",
        secondary: "bg-transparent text-[var(--ink)] border-[var(--line)]",
        ink: "bg-[var(--accent-wash)] text-[var(--ink)] border-[color-mix(in_srgb,var(--blue)_40%,transparent)]",
        destructive:
          "bg-[var(--red-wash)] text-[var(--red)] border-[color-mix(in_srgb,var(--red)_40%,transparent)]",
        outline: "bg-transparent border-[var(--line)] text-[var(--ink)]",
        blocked:
          "bg-transparent text-[var(--ink)] border-[var(--line)] border-dashed",
        ghost: "bg-transparent text-[var(--muted)] border-[var(--line)]",
        link: "bg-transparent text-[var(--link)] border-[var(--line)] underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
