'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { OutcomeNode } from '@/lib/task-hierarchy';

export interface MoveTarget {
  slug: string; // '' = Ungrouped
  label: string;
  level: 'outcome' | 'workstream' | 'none';
  parentLabel?: string;
}

export function MovePicker({
  nodes,
  onPick,
  onClose,
}: {
  nodes: OutcomeNode[];
  onPick: (slug: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const targets = useMemo<MoveTarget[]>(() => {
    const list: MoveTarget[] = [{ slug: '', label: 'Ungrouped', level: 'none' }];
    for (const on of nodes) {
      if (on.outcome) {
        list.push({ slug: on.outcome.slug, label: on.outcome.title, level: 'outcome' });
        for (const ws of on.workstreams) {
          if (ws.workstream)
            list.push({
              slug: ws.workstream.slug,
              label: ws.workstream.title,
              level: 'workstream',
              parentLabel: on.outcome.title,
            });
        }
      }
    }
    return list;
  }, [nodes]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return targets;
    return targets.filter((t) => t.label.toLowerCase().includes(needle) || t.slug.includes(needle));
  }, [q, targets]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setSel(0);
  }, [q]);

  return (
    <div className="tk-overlay open" onClick={onClose} role="dialog" aria-modal="true" aria-label="Move task">
      <div className="tk-sheet tk-movepick" onClick={(e) => e.stopPropagation()}>
        <span className="r-bar">Move / re-parent</span>
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(filtered.length - 1, s + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const t = filtered[sel];
              if (t) onPick(t.slug);
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
          placeholder="filter workstreams + outcomes…"
          aria-label="Filter move targets"
        />
        <div className="tk-opts">
          {filtered.map((t, i) => (
            <div
              key={t.slug || '__ungrouped__'}
              className={`tk-opt${i === sel ? ' sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => onPick(t.slug)}
            >
              <span className="tk-lvl r-mono">{t.level}</span>
              <span>{t.label}</span>
              {t.parentLabel ? <span className="tk-optp r-mono">{t.parentLabel}</span> : null}
            </div>
          ))}
          {filtered.length === 0 ? <div className="tk-opt r-mono">no match</div> : null}
        </div>
      </div>
    </div>
  );
}
