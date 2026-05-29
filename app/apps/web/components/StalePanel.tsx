'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { vaultPageHref } from '@/lib/routes';

interface StaleEntry {
  path: string;
  slug: string;
  title: string | null;
  summary: string | null;
  tier: string | null;
  staleness: number;
  updated: string | null;
  last_accessed: string | null;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function StalePanel() {
  const [entries, setEntries] = useState<StaleEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Lazy-load on first expansion
    if (!open || loaded) return;
    void fetch('/api/stale?limit=50')
      .then((r) => r.json())
      .then((data: StaleEntry[]) => {
        setEntries(data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded]);

  if (!entries.length && loaded && !open) return null;

  return (
    <div className="border-t border-white/5 mt-2 pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1 text-xs text-amber-400/70 hover:text-amber-400 transition-colors text-left"
        aria-expanded={open}
      >
        <span className="text-[10px]">{open ? '▾' : '▸'}</span>
        <span>
          Stale
          {loaded && entries.length > 0 && (
            <span className="ml-1 text-amber-500/60">({entries.length})</span>
          )}
        </span>
      </button>

      {open && (
        <ul className="mt-1 space-y-0.5">
          {!loaded && (
            <li className="px-4 py-1 text-xs text-slate-500 italic">Loading…</li>
          )}
          {loaded && entries.length === 0 && (
            <li className="px-4 py-1 text-xs text-slate-500 italic">No stale pages</li>
          )}
          {entries.map((e) => {
            const refDate = e.last_accessed ?? e.updated;
            const age = daysSince(refDate);
            return (
              <li key={e.path}>
                <Link
                  href={vaultPageHref(e.path)}
                  className="flex flex-col px-4 py-1 hover:bg-white/5 rounded transition-colors group"
                  title={e.summary ?? undefined}
                >
                  <span className="text-xs text-slate-300 group-hover:text-white truncate leading-tight">
                    {e.title ?? e.slug}
                  </span>
                  <span className="text-[10px] text-slate-600 flex gap-1.5">
                    {e.tier && <span>{e.tier}</span>}
                    {age !== null && <span>·{age}d ago</span>}
                    <span className="text-amber-600/60">
                      ·{Math.round(e.staleness * 100)}%
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
