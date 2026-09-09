import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse bg-[color-mix(in_srgb,var(--ink)_10%,var(--card))]", className)}
      {...props}
    />
  )
}

export { Skeleton }
