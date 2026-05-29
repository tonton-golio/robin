'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CircleAlert, RotateCcw, X } from 'lucide-react';
import { isClosedAnnotationStatus } from '@/lib/annotations';
import { Button } from '@/components/ui';

interface AnnotationActionsProps {
  id: string;
  status: string;
  pagePath?: string;
  renderPath?: string;
}

const STATUS_COPY: Record<string, string> = {
  open: 'Reopened from Comments page.',
  resolved: 'Resolved from Comments page.',
  rejected: 'Rejected from Comments page.',
  'needs-attention': 'Marked needs attention from Comments page.',
};

export function AnnotationActions({ id, status, pagePath, renderPath }: AnnotationActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closed = isClosedAnnotationStatus(status);

  async function update(nextStatus: string) {
    setPending(nextStatus);
    setError(null);
    try {
      const res = await fetch('/api/annotations', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id,
          status: nextStatus,
          page_path: pagePath,
          render_path: renderPath ?? pagePath,
          resolution_md: STATUS_COPY[nextStatus] ?? `Marked ${nextStatus} from Comments page.`,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  if (closed) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="xs" disabled={pending !== null} onClick={() => update('open')}>
          <RotateCcw size={12} strokeWidth={1.7} />
          Reopen
        </Button>
        {error ? <span className="font-mono text-[11px] text-[var(--warning-rust)]">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="xs" disabled={pending !== null} onClick={() => update('resolved')}>
        <Check size={12} strokeWidth={1.7} />
        Resolve
      </Button>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={pending !== null}
        onClick={() => update('needs-attention')}
      >
        <CircleAlert size={12} strokeWidth={1.7} />
        Needs attention
      </Button>
      <Button type="button" variant="ghost" size="xs" disabled={pending !== null} onClick={() => update('rejected')}>
        <X size={12} strokeWidth={1.7} />
        Reject
      </Button>
      {error ? <span className="font-mono text-[11px] text-[var(--warning-rust)]">{error}</span> : null}
    </div>
  );
}

