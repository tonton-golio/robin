'use client';

import React, { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { vaultApiFileHref } from '@/lib/routes';

// The thumb is locked to a 16/10 box (see .output-tile-thumb). We render the
// real artifact at a fixed "desktop" size and scale it down to fit the tile,
// so each preview is a faithful miniature of the actual page.
const DESIGN_W = 1200;
const DESIGN_H = (DESIGN_W * 10) / 16; // 750

// Seek the poster a touch past the start so fade-ins don't render as a black
// frame (the launch-video clips open on a fade).
const POSTER_TIME = 0.5;

function fileUrlFor(path: string): string {
  return vaultApiFileHref(path);
}

function PlayBadge(): React.ReactElement {
  return (
    <span className="output-tile-play" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.45)" />
        <path d="M9.5 7.5 16.5 12 9.5 16.5Z" fill="#fff" />
      </svg>
    </span>
  );
}

export function OutputPreview({ path }: { path: string }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  // Seed with a typical tile width (~280px) so the first paint is close, then
  // the ResizeObserver corrects it to the exact width.
  const [scale, setScale] = useState(280 / DESIGN_W);
  const [failed, setFailed] = useState(false);
  // Defer loading video metadata until the tile nears the viewport — an outputs
  // page can hold dozens of clips, and each <video> otherwise fires a network
  // request on mount.
  const [inView, setInView] = useState(false);

  const lower = path.toLowerCase();
  const isImage = /\.(png|jpe?g|gif|webp|avif)$/.test(lower);
  const isHtml = lower.endsWith('.html');
  const isPdf = lower.endsWith('.pdf');
  const isVideo = /\.(mp4|m4v|mov|ogv)$/.test(lower);

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

  useEffect(() => {
    if (!isVideo) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isVideo]);

  if (isImage) {
    return (
      <div ref={ref} className="output-tile-thumb output-tile-thumb--media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fileUrlFor(path)} alt="" loading="lazy" />
      </div>
    );
  }

  if (isVideo && !failed) {
    return (
      <div ref={ref} className="output-tile-thumb output-tile-thumb--video">
        {inView ? (
          <video
            src={`${fileUrlFor(path)}#t=${POSTER_TIME}`}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
            aria-hidden
            onError={() => setFailed(true)}
          />
        ) : null}
        <PlayBadge />
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
