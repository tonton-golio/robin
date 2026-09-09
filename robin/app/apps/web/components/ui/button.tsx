import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Quiet Slate button - the utility-form twin of `.r-btn` in
 * styles/primitives.css. A soft `--radius` rectangle that separates by
 * elevation, not by an outline: it rests at `--offset-sm`, RAISES to `--offset`
 * on hover and drops to no shadow on press. Nothing translates any more, and a
 * filled variant carries a shadow OR a border, never both (spec invariant 3).
 * Colours via tokens only. The focus ring is handled globally by primitives.css
 * (2px accent outline, 2px offset), so there are no ring utilities here.
 * Variant/size names are unchanged from the shadcn base so existing consumers
 * keep working; `ink` is now the marked state (accent wash + accent spine),
 * not an ink brick.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] text-sm font-medium outline-none transition-[box-shadow,background-color,color] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 shadow-[var(--offset-sm)] hover:shadow-[var(--offset)] active:shadow-none",
  {
    variants: {
      variant: {
        default: "bg-card text-foreground",
        primary: "bg-primary text-primary-foreground",
        ink: "bg-[var(--accent-wash)] text-foreground shadow-[inset_2px_0_0_var(--blue)] hover:shadow-[inset_2px_0_0_var(--blue)] active:shadow-[inset_2px_0_0_var(--blue)]",
        destructive: "bg-destructive text-[var(--on-red)]",
        outline:
          "border border-[var(--line-strong)] bg-card text-foreground shadow-none hover:shadow-none active:shadow-none",
        secondary: "bg-card text-foreground",
        ghost:
          "bg-transparent text-foreground shadow-none hover:bg-[var(--card-2)] hover:shadow-none active:shadow-none",
        link: "bg-transparent text-primary underline-offset-4 shadow-none hover:underline hover:shadow-none active:shadow-none",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
