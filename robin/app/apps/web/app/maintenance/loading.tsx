import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading UI for the maintenance route. The page is `force-dynamic` and runs
 * several full vault scans (the known multi-second latency), so Next shows this
 * skeleton instantly on navigation instead of leaving the previous page frozen.
 * Mirrors the real layout: header + total-issues card, the six-count grid, and
 * a couple of issue-section card stacks.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-10 pb-16 sm:px-14" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading maintenance snapshot…</span>

      <div className="mb-7 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-3 h-3 w-28" />
          <Skeleton className="mb-2 h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Skeleton className="h-[88px] w-[150px] rounded-xl" />
      </div>

      <section className="mb-7 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[68px] rounded-xl" />
        ))}
      </section>

      <div className="grid gap-5">
        {Array.from({ length: 3 }).map((_, section) => (
          <section key={section}>
            <div className="mb-3 flex items-start justify-between gap-3 border-b border-border pb-2.5">
              <div className="min-w-0 flex-1">
                <Skeleton className="mb-2 h-4 w-40" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            <div className="grid gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[72px] rounded-xl" />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
