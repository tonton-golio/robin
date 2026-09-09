"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { PeekPreview } from "./types";

// The peek frame renders the real artifact at a fixed "desktop" width and scales
// it to the panel. At the panel's ~640px this lands near 0.53 — a readable
// half-page, where the old 0.23 tile thumbnails were grey noise. This component
// is mounted only while peek is open, so the page holds at most ONE live
// same-origin document instead of the ~27 the tile grid used to mount.
const DESIGN_W = 1200;

export function OutputPreview({
  preview,
  title,
  /** Width the artifact is rendered at before scaling. The peek sheet uses the
   *  full 1200 "desktop" width; the narrower dock renders at 860 so its scale
   *  lands near 0.5 instead of 0.35 — the difference between readable and the
   *  grey noise the old tile thumbnails were. */
  designWidth = DESIGN_W,
  /** Frames taller than 10:16 show more of the document per swap. */
  aspect = 10 / 16,
}: {
  preview: PeekPreview;
  title: string;
  designWidth?: number;
  aspect?: number;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(640 / designWidth);
  const designHeight = designWidth * aspect;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      if (el.clientWidth > 0) setScale(el.clientWidth / designWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [designWidth]);

  if (preview.kind === "poster" && preview.poster) {
    return (
      <div ref={ref} className="out-peek-frame out-peek-frame--media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.poster} alt={`Rendered poster for ${title}`} />
      </div>
    );
  }

  if (preview.kind === "video" && preview.src) {
    return (
      <div ref={ref} className="out-peek-frame out-peek-frame--media">
        <video src={preview.src} poster={preview.poster} controls preload="metadata" playsInline />
      </div>
    );
  }

  if (preview.kind === "text") {
    return (
      <div ref={ref} className="out-peek-frame out-peek-frame--text">
        <p className="r-mono out-peek-note">{preview.note}</p>
        <pre className="out-peek-src">{preview.text}</pre>
      </div>
    );
  }

  if (preview.kind === "iframe" && preview.src) {
    return (
      <div ref={ref} className="out-peek-frame out-peek-frame--doc">
        <iframe
          src={preview.src}
          title={`Preview of ${title}`}
          tabIndex={-1}
          scrolling="no"
          sandbox="allow-same-origin"
          style={{
            width: designWidth,
            height: designHeight,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
      </div>
    );
  }

  return (
    <div ref={ref} className="out-peek-frame out-peek-frame--none">
      <p className="r-mono out-peek-note">{preview.note ?? "no preview exists for this file"}</p>
    </div>
  );
}
