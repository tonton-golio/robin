'use client';

import React, { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { vaultApiFileHref } from '@/lib/routes';

// The thumb is locked to a 16/10 box (see .output-tile-thumb). We render the
// real artifact at a fixed "desktop" size and scale it down to fit the tile,
// so each preview is a faithful miniature of the actual page.
const DESIGN_W = 1200;
const DESIGN_H = (DESIGN_W * 10) / 16; // 750

function fileUrlFor(path: string): string {
  return vaultApiFileHref(path);
}

export function OutputPreview({ path }: { path: string }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  // Seed with a typical tile width (~280px) so the first paint is close, then
  // the ResizeObserver corrects it to the exact width.
  const [scale, setScale] = useState(280 / DESIGN_W);
  const [failed, setFailed] = useState(false);

  const lower = path.toLowerCase();
  const isImage = /\.(png|jpe?g|gif|webp|avif)$/.test(lower);
  const isHtml = lower.endsWith('.html');
  const isPdf = lower.endsWith('.pdf');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      if (el.clientWidth > 0) setScale(el.clientWidth / DESIGN_W);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (isImage) {
    return (
      <div ref={ref} className="output-tile-thumb output-tile-thumb--media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fileUrlFor(path)} alt="" loading="lazy" />
      </div>
    );
  }

  if ((isHtml || isPdf) && !failed) {
    return (
      <div ref={ref} className="output-tile-thumb output-tile-thumb--frame">
        <iframe
          src={fileUrlFor(path) + (isPdf ? '#toolbar=0&navpanes=0&view=FitH' : '')}
          title=""
          aria-hidden
          tabIndex={-1}
          loading="lazy"
          scrolling="no"
          sandbox="allow-same-origin"
          onError={() => setFailed(true)}
          style={{
            width: DESIGN_W,
            height: DESIGN_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      </div>
    );
  }

  return (
    <div ref={ref} className="output-tile-thumb">
      <FileText size={28} strokeWidth={1.2} />
    </div>
  );
}
