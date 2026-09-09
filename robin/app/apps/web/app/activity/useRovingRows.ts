'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * One-cursor roving focus over the rows of a lens. Roving selection IS real DOM
 * focus (spec §8): j/k (and ↓/↑) call .focus() on the next/prev row element
 * carrying [data-activity-row], and native Tab landing on a row is respected
 * because we never track a separate selection index — the focused element is
 * the single source of truth. The visual cursor is driven by :focus-visible in
 * CSS, so keyboard focus shows the ink border + offset shadow and mouse clicks
 * do not.
 *
 * `onRowKey` lets a lens bind row-scoped keys (x/u/r/a/o) to the currently
 * focused row without re-deriving which row that is.
 */
export function useRovingRows(opts: {
  /** Lens-local key handler; receives the focused row element. */
  onRowKey?: (key: string, row: HTMLElement, event: KeyboardEvent) => void;
  /** Whether this lens is the active one (only the active lens binds keys). */
  active: boolean;
}) {
  const { onRowKey, active } = opts;
  const containerRef = useRef<HTMLDivElement | null>(null);

  const rows = useCallback((): HTMLElement[] => {
    const el = containerRef.current;
    if (!el) return [];
    return Array.from(el.querySelectorAll<HTMLElement>('[data-activity-row]:not([hidden])')).filter(
      (r) => r.offsetParent !== null,
    );
  }, []);

  const move = useCallback(
    (delta: number) => {
      const list = rows();
      if (list.length === 0) return;
      const current = document.activeElement as HTMLElement | null;
      const idx = current ? list.indexOf(current) : -1;
      let next = idx + delta;
      if (idx === -1) next = delta > 0 ? 0 : list.length - 1;
      next = Math.max(0, Math.min(list.length - 1, next));
      list[next]?.focus();
    },
    [rows],
  );

  useEffect(() => {
    if (!active) return undefined;
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      // Never hijack keys while typing in an input/textarea/select.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
        return;
      }
      // Row-scoped keys: only when a row is focused.
      const focused = document.activeElement as HTMLElement | null;
      const row = focused?.closest<HTMLElement>('[data-activity-row]');
      if (row && onRowKey) {
        onRowKey(e.key, row, e);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, move, onRowKey]);

  return { containerRef, move };
}
