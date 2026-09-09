'use client';

import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { vaultApiFileHref } from '@/lib/routes';

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


/** Static card faces: opening a tile loads its full document or playable video. */
export function OutputPreview({ path, poster }: { path: string; poster?: string }): React.ReactElement {
  const isVideo = /\.(mp4|webm|m4v|mov|ogv)$/i.test(path);
  const isImage = /\.(png|jpe?g|gif|webp|avif)$/i.test(path);
  const src = poster ?? (isImage ? path : undefined);
  const [failedSrc, setFailedSrc] = useState<string>();

  return (
    <div className={`output-tile-thumb ${isVideo ? 'output-tile-thumb--video' : 'output-tile-thumb--media'}`}>
      {src && failedSrc !== src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={vaultApiFileHref(src)} alt="" loading="lazy" onError={() => setFailedSrc(src)} />
      ) : (
        <FileText size={28} strokeWidth={1.2} />
      )}
      {isVideo ? <PlayBadge /> : null}
    </div>
  );
}
