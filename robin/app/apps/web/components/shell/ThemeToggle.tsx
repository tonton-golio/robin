'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'robin-theme';

function readTheme(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.dataset.theme;
    if (attr === 'light' || attr === 'dark') return attr;
  }
  // Quiet Slate is dark-first: no stamped preference means dark.
  return 'dark';
}

/**
 * Icon button that flips the Quiet Slate palette between dark and light.
 * Writes localStorage 'robin-theme' + stamps `data-theme` on <html>; the
 * no-flash bootstrap in layout.tsx reads the same key on next load. CSS in
 * shell.css swaps the sun/moon glyph off `:root[data-theme]`.
 */
export function ThemeToggle() {
  // Start unset to keep SSR + first client render identical (no hydration
  // mismatch); sync from the DOM (set by the bootstrap script) after mount.
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // private mode - in-memory only
    }
  }

  return (
    <button
      type="button"
      className="robin-iconbtn robin-theme-toggle"
      onClick={toggle}
      // Reflect the live theme locally too, so the glyph swap works even before
      // the <html> attribute settles.
      data-theme={mounted ? theme : undefined}
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <span className="robin-theme-toggle-sun" aria-hidden>
        <Sun size={16} strokeWidth={1.5} />
      </span>
      <span className="robin-theme-toggle-moon" aria-hidden>
        <Moon size={16} strokeWidth={1.5} />
      </span>
    </button>
  );
}
