'use client';

import { useEffect } from 'react';

/**
 * Fires navigator.sendBeacon (or fetch fallback) on mount to increment
 * the access counter for the current page in the index.
 *
 * This is a client component so it can run useEffect after hydration.
 */
export function AccessBeacon({ path }: { path: string }) {
  useEffect(() => {
    const url = `/api/page/access?path=${encodeURIComponent(path)}`;
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(url);
    } else {
      // Fallback for environments without sendBeacon
      void fetch(url, { method: 'POST', keepalive: true }).catch(() => undefined);
    }
  }, [path]);

  return null;
}
