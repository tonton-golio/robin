'use client';

import { Plus } from 'lucide-react';
import { WORKSPACES, workspaceForPath } from '@/lib/workspaces';
import { WorkspaceLink } from './WorkspaceLink';
import type { WorkspaceSummary } from './useWorkspaceSummary';

const MOBILE_IDS = new Set(['day', 'inbox', 'library', 'review']);

function countFor(id: string, summary: WorkspaceSummary): number {
  if (id === 'inbox') return summary.inbox;
  if (id === 'review') return summary.review;
  return 0;
}

export function MobileWorkspaceNav({
  pathname,
  summary,
  onCapture,
  captureOpen,
}: {
  pathname: string;
  summary: WorkspaceSummary;
  onCapture: () => void;
  captureOpen: boolean;
}) {
  const current = workspaceForPath(pathname);
  const items = WORKSPACES.filter((item) => MOBILE_IDS.has(item.id));
  const byId = new Map(items.map((item) => [item.id, item]));
  const beforeCapture = (['day', 'inbox'] as const)
    .map((id) => byId.get(id))
    .filter((item): item is (typeof WORKSPACES)[number] => Boolean(item));
  const afterCapture = (['library', 'review'] as const)
    .map((id) => byId.get(id))
    .filter((item): item is (typeof WORKSPACES)[number] => Boolean(item));

  const renderItem = (item: (typeof WORKSPACES)[number]) => {
    const Icon = item.icon;
    const count = countFor(item.id, summary);
    return (
      <WorkspaceLink
        key={item.id}
        href={item.href}
        className="workspace-mobile-link"
        aria-current={current?.id === item.id ? 'page' : undefined}
      >
        {count > 0 ? <span className="workspace-mobile-count">{count > 9 ? '9+' : count}</span> : null}
        <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
        <span>{item.label}</span>
      </WorkspaceLink>
    );
  };

  return (
    <nav className="workspace-mobile-nav" aria-label="Primary">
      {beforeCapture.map(renderItem)}
      <button
        type="button"
        className="workspace-mobile-link workspace-mobile-capture"
        onClick={onCapture}
        aria-label="Capture"
        aria-haspopup="dialog"
        aria-expanded={captureOpen}
        aria-controls="workspace-capture-dialog"
      >
        <span className="workspace-mobile-capture-mark">
          <Plus size={23} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span>Capture</span>
      </button>
      {afterCapture.map(renderItem)}
    </nav>
  );
}
