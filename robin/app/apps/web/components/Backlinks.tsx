import Link from 'next/link';
import type React from 'react';
import type { BacklinkEntry } from '@/lib/indexer-client';
import { vaultPageHref } from '@/lib/routes';

interface BacklinksProps {
  backlinks: BacklinkEntry[];
  currentSlug?: string;
}

const TYPE_ICONS: Record<string, string> = {
  task: '✓',
  person: '👤',
  project: '◆',
  meeting: '◎',
  interview: '◉',
  knowledge: '◈',
  understanding: '◈',
  brief: '◧',
  report: '◨',
  index: '⊞',
  note: '◻',
};

function typeIcon(type?: string): string {
  return (type && TYPE_ICONS[type]) ?? '◻';
}

/**
 * Right sidebar panel listing all pages that link into the current page.
 */
export function Backlinks({ backlinks, currentSlug }: BacklinksProps): React.ReactElement {
  return (
    <aside className="backlinks-panel">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 px-1">
        Linked from
      </h3>

      {backlinks.length === 0 ? (
        <p className="text-xs text-slate-600 px-1 italic">No backlinks</p>
      ) : (
        <ul className="space-y-1">
          {backlinks.map((bl) => {
            const isSelf = bl.slug === currentSlug;
            return (
              <li key={bl.path} className={isSelf ? 'opacity-40' : ''}>
                <Link
                  href={vaultPageHref(bl.path)}
                  className="flex items-start gap-1.5 text-xs px-1 py-0.5 rounded hover:bg-white/5 transition-colors group"
                >
                  <span className="text-slate-500 mt-0.5 flex-shrink-0 font-mono text-[10px]">
                    {typeIcon(bl.type)}
                  </span>
                  <span className="text-slate-300 group-hover:text-slate-100 transition-colors leading-snug break-words">
                    {bl.title}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
