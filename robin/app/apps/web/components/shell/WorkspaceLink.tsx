'use client';

import Link, { type LinkProps } from 'next/link';
import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { useActiveDocument } from './ActiveDocumentProvider';

type WorkspaceLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    onNavigateStart?: () => void;
  };

export function WorkspaceLink({
  href,
  onClick,
  onNavigateStart,
  children,
  ...props
}: WorkspaceLinkProps) {
  const { hasDirtyDocument, requestNavigation } = useActiveDocument();
  const hrefString = typeof href === 'string' ? href : href.pathname ?? '';

  return (
    <Link
      href={href}
      {...props}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        onNavigateStart?.();
        if (!hasDirtyDocument || !hrefString) return;
        event.preventDefault();
        requestNavigation(hrefString);
      }}
    >
      {children}
    </Link>
  );
}
