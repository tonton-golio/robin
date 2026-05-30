'use client';

import Link from 'next/link';
import type React from 'react';
import { vaultPageHref } from '@/lib/routes';

export type WikiLinkState = 'resolved' | 'broken' | 'ambiguous' | 'archived';

interface WikiLinkProps {
  slug: string;
  label: string;
  state: WikiLinkState;
  /** Vault-relative path without .html, e.g. 'brain/risk-register' */
  resolvedPath?: string;
}

/**
 * Renders a wikilink with visual state:
 * - resolved: normal blue link
 * - broken (missing): red dashed underline
 * - ambiguous: yellow dashed underline
 * - archived: grey strikethrough
 */
export function WikiLink({ slug, label, state, resolvedPath }: WikiLinkProps): React.ReactElement {
  const href = resolvedPath ? vaultPageHref(resolvedPath) : `/p/${slug}`;

  if (state === 'broken') {
    return (
      <a
        href={href}
        data-wiki={slug}
        data-broken="missing"
        title={`Broken link: [[${slug}]]`}
      >
        {label}
      </a>
    );
  }

  if (state === 'ambiguous') {
    return (
      <a
        href={href}
        data-wiki={slug}
        data-broken="ambiguous"
        title={`Ambiguous link: [[${slug}]] matches multiple pages`}
      >
        {label}
      </a>
    );
  }

  if (state === 'archived') {
    return (
      <Link
        href={href}
        data-wiki={slug}
        data-archived="true"
        title={`Archived: [[${slug}]]`}
      >
        {label}
      </Link>
    );
  }

  // resolved
  return (
    <Link href={href} data-wiki={slug}>
      {label}
    </Link>
  );
}
