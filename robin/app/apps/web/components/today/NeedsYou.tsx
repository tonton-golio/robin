'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, ExternalLink, ShieldQuestion } from 'lucide-react';
import type { InterventionItem, InterventionResolution } from '@/lib/interventions';

export function NeedsYou({ initialItems }: { initialItems: InterventionItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems.slice(0, 5));
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (item: InterventionItem, resolution: InterventionResolution) => {
    setPending(item.path);
    setError(null);
    try {
      const response = await fetch('/api/intervention/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: item.path, resolution }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `Resolution failed (${response.status})`);
      setItems(current => current.filter(candidate => candidate.path !== item.path));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="needs-you" aria-labelledby="needs-you-title">
      <div className="needs-you-head">
        <div>
          <span className="needs-you-kicker">Attention</span>
          <h2 id="needs-you-title">Needs you</h2>
        </div>
        <span className="needs-you-count" aria-label={`${items.length} open judgment items`}>
          {items.length.toString().padStart(2, '0')}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="needs-you-clear">
          <Check size={15} strokeWidth={1.6} />
          <span>No judgment calls waiting. Robin will keep watching.</span>
        </div>
      ) : (
        <div className="needs-you-list">
          {items.map((item, index) => (
            <article className="needs-you-item" key={item.path}>
              <div className="needs-you-rank" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
              <div className="needs-you-content">
                <div className="needs-you-title-row">
                  <div>
                    <span className="needs-you-evidence" data-state={item.evidenceState}>
                      <ShieldQuestion size={12} strokeWidth={1.7} />
                      {evidenceLabel(item.evidenceState)}
                    </span>
                    <h3>{item.title}</h3>
                  </div>
                  <Link href={item.href} className="needs-you-open" aria-label="Open judgment record">
                    <ExternalLink size={13} strokeWidth={1.5} />
                  </Link>
                </div>

                <div className="needs-you-reasoning">
                  <p><span>Why now</span>{item.whyNow}</p>
                  {item.belief && <p><span>Robin&apos;s belief</span>{item.belief}</p>}
                  {item.targetTitle && <p><span>Will update</span>{item.targetTitle}, with edit history.</p>}
                </div>

                <div className="needs-you-actions">
                  {item.kind === 'commitment-checkpoint' ? (
                    <>
                      <button
                        type="button"
                        className="needs-you-primary"
                        disabled={pending === item.path}
                        onClick={() => resolve(item, 'fulfilled')}
                      >
                        {pending === item.path ? 'Recording…' : 'Kept'}
                      </button>
                      <button type="button" disabled={pending === item.path} onClick={() => resolve(item, 'missed')}>
                        Missed
                      </button>
                      <button type="button" disabled={pending === item.path} onClick={() => resolve(item, 'cancelled')}>
                        Released
                      </button>
                    </>
                  ) : item.kind === 'conflict' ? (
                    <>
                      <button
                        type="button"
                        className="needs-you-primary"
                        disabled={pending === item.path}
                        onClick={() => resolve(item, 'proposed')}
                      >
                        {pending === item.path ? 'Applying…' : `Use ${item.proposedValue ?? 'meeting value'}`}
                      </button>
                      <button type="button" disabled={pending === item.path} onClick={() => resolve(item, 'existing')}>
                        Keep {item.existingValue ?? 'current'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="needs-you-primary"
                      disabled={pending === item.path}
                      onClick={() => resolve(item, 'confirmed')}
                    >
                      {pending === item.path ? 'Confirming…' : 'Confirm'}
                    </button>
                  )}
                  {item.commitmentHref && <Link href={item.commitmentHref}>Open promise</Link>}
                  {item.sourceHref && <Link href={item.sourceHref}>Review evidence</Link>}
                  {item.kind !== 'commitment-checkpoint' && (
                    <button type="button" disabled={pending === item.path} onClick={() => resolve(item, 'dismissed')}>
                      Not relevant
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {error && <p className="needs-you-error" role="alert">Could not resolve: {error}</p>}
    </section>
  );
}

function evidenceLabel(value: string): string {
  if (value === 'conflicting' || value === 'conflicting evidence') return 'Conflicting evidence';
  if (value === 'reported') return 'Reported';
  if (value === 'confirmed') return 'Confirmed';
  if (value === 'stale') return 'Checkpoint passed';
  return 'Tentative';
}
