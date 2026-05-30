import React from 'react';
import { PrintButton } from '@/components/PrintButton';

interface PageWorkspaceProps {
  title: string;
  summary?: string;
  renderPath: string;
  mtime?: string;
  children: React.ReactNode;
}

export function PageWorkspace({
  title,
  summary,
  renderPath,
  mtime,
  children,
}: PageWorkspaceProps): React.ReactElement {
  // Only shareable out/ artifacts (reports, plans) get a PDF export affordance;
  // brain/logs reader pages don't.
  const isOutput = renderPath.startsWith('out/');
  return (
    <article
      className="robin-doc-article mx-auto max-w-[760px] px-5 pb-20 pt-12 sm:px-16"
      data-robin-annotate-root
    >
      {isOutput ? (
        <div className="robin-doc-toolbar no-print mb-4 flex justify-end">
          <PrintButton />
        </div>
      ) : null}
      <header className="mb-9 border-b border-border pb-[22px]">
        <h1
          className="m-0 mb-3.5 font-normal tracking-tight text-foreground"
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(28px, 4vw, 38px)',
            lineHeight: 1.2,
          }}
        >
          {title}
        </h1>
        {summary ? (
          <p
            className="m-0 mb-[18px] text-[17px] leading-relaxed text-muted-foreground"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {summary}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-4 font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
          <span className="break-all">{renderPath}</span>
          {mtime ? (
            <span>
              updated{' '}
              {new Date(mtime).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          ) : null}
        </div>
      </header>
      <div className="robin-prose text-[15px] leading-[1.65] text-foreground">{children}</div>
    </article>
  );
}
