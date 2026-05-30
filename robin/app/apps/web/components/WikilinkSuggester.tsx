'use client';

/**
 * WikilinkSuggester — popup when user types [[ in the editor.
 *
 * Used as a SuggestionMenu in BlockNote, fetching from /api/search or /api/tree.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

export interface WikilinkSuggestion {
  slug: string;
  title: string;
  type?: string;
}

interface WikilinkSuggesterProps {
  query: string;
  onSelect: (suggestion: WikilinkSuggestion) => void;
  onClose: () => void;
  position?: { top: number; left: number };
}

export function WikilinkSuggester({
  query,
  onSelect,
  onClose,
  position,
}: WikilinkSuggesterProps): React.ReactElement | null {
  const [suggestions, setSuggestions] = useState<WikilinkSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch suggestions when query changes
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    const controller = new AbortController();

    fetch(`/api/search?q=${encodeURIComponent(query)}&k=8`, {
      signal: controller.signal,
    })
      .then((r) => r.json() as Promise<{ hits: Array<{ slug: string; title: string; type?: string }> }>)
      .then((data) => {
        setSuggestions(
          data.hits.map((h) => ({ slug: h.slug, title: h.title, type: h.type }))
        );
        setActiveIndex(0);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    return () => controller.abort();
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const s = suggestions[activeIndex];
        if (s) onSelect(s);
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        onClose();
      }
    },
    [suggestions, activeIndex, onSelect, onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  if (!query.trim() && suggestions.length === 0) return null;

  const style: React.CSSProperties = position
    ? { top: position.top, left: position.left, position: 'fixed' }
    : { position: 'absolute', top: '100%', left: 0 };

  return (
    <div
      ref={containerRef}
      className="z-50 min-w-64 max-w-80 bg-[#1a1f2e] border border-white/20 rounded-lg shadow-xl overflow-hidden"
      style={style}
    >
      {loading && (
        <div className="px-3 py-2 text-xs text-slate-500">Searching...</div>
      )}
      {!loading && suggestions.length === 0 && query.trim() && (
        <div className="px-3 py-2 text-xs text-slate-500">No results for &ldquo;{query}&rdquo;</div>
      )}
      {suggestions.map((s, i) => (
        <button
          key={s.slug}
          className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm hover:bg-white/10 transition-colors ${
            i === activeIndex ? 'bg-[rgba(232,161,60,0.16)] text-[var(--robin-amber)]' : 'text-slate-200'
          }`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(s);
          }}
          onMouseEnter={() => setActiveIndex(i)}
        >
          {s.type && (
            <span className="text-xs text-slate-500 font-mono shrink-0">{s.type}</span>
          )}
          <span className="truncate">{s.title}</span>
          <span className="text-xs text-slate-600 truncate shrink-0 ml-auto">{s.slug}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Hook to detect [[ in text and manage wikilink suggester state.
 */
export function useWikilinkSuggester() {
  const [query, setQuery] = useState<string | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | undefined>();

  const open = useCallback((q: string, pos?: { top: number; left: number }) => {
    setQuery(q);
    setPosition(pos);
  }, []);

  const close = useCallback(() => {
    setQuery(null);
    setPosition(undefined);
  }, []);

  const updateQuery = useCallback((q: string) => {
    setQuery(q);
  }, []);

  return { query, position, open, close, updateQuery, isOpen: query !== null };
}
