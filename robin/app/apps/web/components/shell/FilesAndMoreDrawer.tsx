'use client';

import { Keyboard, X } from 'lucide-react';
import { SECONDARY_DESTINATIONS, WORKSPACES, workspaceForPath } from '@/lib/workspaces';
import { VaultTree } from '@/components/vault/VaultTree';
import { ResyncButton } from './ResyncButton';
import { ThemeToggle } from './ThemeToggle';
import { WorkspaceLink } from './WorkspaceLink';
import type { WorkspaceSummary } from './useWorkspaceSummary';
import {
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetRoot,
  SheetTitle,
} from '@/components/ui/sheet';

function countFor(id: string, summary: WorkspaceSummary): number {
  if (id === 'inbox') return summary.inbox;
  if (id === 'review') return summary.review;
  return 0;
}

export function FilesAndMoreDrawer({
  open,
  onOpenChange,
  pathname,
  summary,
  showFiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pathname: string;
  summary: WorkspaceSummary;
  showFiles: boolean;
}) {
  const current = workspaceForPath(pathname);
  const close = () => onOpenChange(false);

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        id="workspace-files-sheet"
        className="workspace-files-sheet"
      >
        <div className="workspace-sheet-header">
          <div>
            <SheetTitle>{showFiles ? 'Files and more' : 'More'}</SheetTitle>
            <SheetDescription>
              {showFiles
                ? 'Workspaces, files, and secondary tools.'
                : 'Secondary workspaces and system tools.'}
            </SheetDescription>
          </div>
          <SheetClose type="button" className="workspace-icon-button" aria-label="Close files and more">
            <X size={18} strokeWidth={1.7} aria-hidden="true" />
          </SheetClose>
        </div>

        <div className="workspace-sheet-scroll">
          {showFiles ? (
            <>
              <nav className="workspace-drawer-nav" aria-label="Workspaces">
                <p className="workspace-nav-label">Workspaces</p>
                {WORKSPACES.map((item) => {
                  const Icon = item.icon;
                  const count = countFor(item.id, summary);
                  return (
                    <WorkspaceLink
                      key={item.id}
                      href={item.href}
                      className="workspace-nav-link"
                      aria-current={current?.id === item.id ? 'page' : undefined}
                      onNavigateStart={close}
                    >
                      <Icon size={18} strokeWidth={1.65} aria-hidden="true" />
                      <span>{item.label}</span>
                      {count > 0 ? <span className="workspace-count">{count}</span> : null}
                    </WorkspaceLink>
                  );
                })}
              </nav>

              <section className="workspace-drawer-files" aria-label="Files">
                <p className="workspace-nav-label">Files</p>
                <VaultTree onNavigate={close} />
              </section>
            </>
          ) : null}

          <nav className="workspace-drawer-nav" aria-label="More">
            <p className="workspace-nav-label">More</p>
            {SECONDARY_DESTINATIONS.map((item) => {
              const Icon = item.icon;
              return (
                <WorkspaceLink
                  key={item.href}
                  href={item.href}
                  className="workspace-nav-link"
                  aria-current={item.match(pathname) ? 'page' : undefined}
                  onNavigateStart={close}
                >
                  <Icon size={18} strokeWidth={1.65} aria-hidden="true" />
                  <span>{item.label}</span>
                </WorkspaceLink>
              );
            })}
            <button
              type="button"
              className="workspace-nav-link"
              onClick={() => {
                close();
                window.setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('robin:shortcuts'));
                }, 0);
              }}
            >
              <Keyboard size={18} strokeWidth={1.65} aria-hidden="true" />
              <span>Keyboard shortcuts</span>
            </button>
          </nav>
        </div>

        <div className="workspace-sheet-tools">
          <ResyncButton />
          <ThemeToggle />
        </div>
      </SheetContent>
    </SheetRoot>
  );
}
