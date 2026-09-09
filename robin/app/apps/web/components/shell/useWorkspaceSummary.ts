'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export interface WorkspaceSummary {
  inbox: number;
  review: number;
  degraded?: string[];
}

const EMPTY: WorkspaceSummary = { inbox: 0, review: 0 };

export function useWorkspaceSummary(): WorkspaceSummary {
  const pathname = usePathname();
  const [summary, setSummary] = useState<WorkspaceSummary>(EMPTY);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/workspace/summary', { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as Partial<WorkspaceSummary>;
      setSummary({
        inbox: Number.isFinite(body.inbox) ? Math.max(0, Number(body.inbox)) : 0,
        review: Number.isFinite(body.review) ? Math.max(0, Number(body.review)) : 0,
        degraded: Array.isArray(body.degraded)
          ? body.degraded.filter((value): value is string => typeof value === 'string')
          : undefined,
      });
    } catch {
      // Counts are progressive enhancement. The destination remains available.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    const onFocus = () => void refresh();
    const onMutation = () => void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('robin:workspace-summary', onMutation);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('robin:workspace-summary', onMutation);
    };
  }, [refresh]);

  return summary;
}
