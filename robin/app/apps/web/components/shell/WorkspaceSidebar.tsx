'use client';

import { WORKSPACES, workspaceForPath } from '@/lib/workspaces';
import { VaultTree } from '@/components/vault/VaultTree';
import { WorkspaceLink } from './WorkspaceLink';
import type { WorkspaceSummary } from './useWorkspaceSummary';
import { MoreHorizontal } from 'lucide-react';

function countFor(id: string, summary: WorkspaceSummary): number {
  if (id === 'inbox') return summary.inbox;
  if (id === 'review') return summary.review;
  return 0;
}

export function WorkspaceSidebar({
  pathname,
  summary,
  onMore,
  moreOpen,
}: {
  pathname: string;
  summary: WorkspaceSummary;
  onMore: () => void;
  moreOpen: boolean;
}) {
  const current = workspaceForPath(pathname);

  return (
    <aside className="workspace-sidebar" aria-label="Workspace sidebar">
      <WorkspaceLink href="/" className="workspace-brand" aria-label="Robin home">
        <span className="workspace-brand-mark" aria-hidden="true">R</span>
        <span>Robin</span>
      </WorkspaceLink>

      <nav className="workspace-primary-nav" aria-label="Primary">
        <p className="workspace-nav-label">Workspaces</p>
        {WORKSPACES.map((item) => {
          const Icon = item.icon;
          const count = countFor(item.id, summary);
          const active = current?.id === item.id;
          return (
            <WorkspaceLink
              key={item.id}
              href={item.href}
              className="workspace-nav-link"
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={19} strokeWidth={1.65} aria-hidden="true" />
              <span>{item.label}</span>
              {count > 0 ? (
                <span className="workspace-count" aria-label={`${count} waiting`}>
                  {count > 99 ? '99+' : count}
                </span>
              ) : null}
            </WorkspaceLink>
          );
        })}
      </nav>

      <section className="workspace-files" aria-label="Files">
        <p className="workspace-nav-label">Files</p>
        <VaultTree />
      </section>

      <div className="workspace-sidebar-foot">
        <span className="workspace-health-dot" aria-hidden="true" />
        <span>Local archive</span>
        <button
          type="button"
          className="workspace-sidebar-more"
          onClick={onMore}
          aria-label="Open more tools"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-controls="workspace-files-sheet"
        >
          <MoreHorizontal size={18} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
