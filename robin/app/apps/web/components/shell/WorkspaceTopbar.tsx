'use client';

import { Menu, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useActiveDocument, type DocumentWriteState } from './ActiveDocumentProvider';
import { workspaceForPath } from '@/lib/workspaces';

function shortTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function writeLabel(state: DocumentWriteState | undefined, updatedAt?: string): string {
  if (!state) return 'live';
  switch (state.kind) {
    case 'read-only':
      return 'read only';
    case 'saved':
      return state.at ? `saved ${shortTimestamp(state.at)}` : 'saved';
    case 'dirty':
      return 'unsaved';
    case 'saving':
      return 'saving…';
    case 'stale':
      return state.modifiedAt ? `changed ${shortTimestamp(state.modifiedAt)}` : 'changed on disk';
    case 'conflict':
      return 'write conflict';
    case 'error':
      return 'save failed';
    default:
      return updatedAt ? `updated ${shortTimestamp(updatedAt)}` : 'live';
  }
}

export function WorkspaceTopbar({
  pathname,
  onFiles,
  onSearch,
  onCapture,
  onContext,
  filesOpen,
  searchOpen,
  captureOpen,
  contextOpen,
}: {
  pathname: string;
  onFiles: () => void;
  onSearch: () => void;
  onCapture: () => void;
  onContext: () => void;
  filesOpen: boolean;
  searchOpen: boolean;
  captureOpen: boolean;
  contextOpen: boolean;
}) {
  const { document } = useActiveDocument();
  const workspace = workspaceForPath(pathname);
  const path = document?.path ?? workspace?.label ?? 'Robin';
  const state = document?.writeState;
  const label = writeLabel(state, document?.updatedAt);

  return (
    <header className="workspace-topbar">
      <button
        type="button"
        className="workspace-icon-button workspace-files-trigger"
        onClick={onFiles}
        aria-label="Open files and more"
        aria-haspopup="dialog"
        aria-expanded={filesOpen}
        aria-controls="workspace-files-sheet"
      >
        <Menu size={18} strokeWidth={1.7} aria-hidden="true" />
      </button>

      <button
        type="button"
        className="workspace-file-tab"
        data-write-state={state?.kind ?? 'live'}
        onClick={onContext}
        aria-haspopup="dialog"
        aria-expanded={contextOpen}
        aria-controls="workspace-context-sheet"
        aria-label={`${path}, ${label}. Open context`}
      >
        <span className="workspace-write-dot" aria-hidden="true" />
        <span className="workspace-file-path">{path}</span>
        <span className="workspace-file-state">{label}</span>
      </button>

      <div className="workspace-topbar-actions">
        <button
          type="button"
          className="workspace-toolbar-button"
          onClick={onSearch}
          aria-haspopup="dialog"
          aria-expanded={searchOpen}
        >
          <Search size={17} strokeWidth={1.65} aria-hidden="true" />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          type="button"
          className="workspace-toolbar-button workspace-capture-trigger"
          onClick={onCapture}
          aria-haspopup="dialog"
          aria-expanded={captureOpen}
          aria-controls="workspace-capture-dialog"
        >
          <Plus size={17} strokeWidth={1.7} aria-hidden="true" />
          <span>Capture</span>
        </button>
        <button
          type="button"
          className="workspace-toolbar-button workspace-context-trigger"
          onClick={onContext}
          aria-haspopup="dialog"
          aria-expanded={contextOpen}
          aria-controls="workspace-context-sheet"
        >
          <SlidersHorizontal size={17} strokeWidth={1.65} aria-hidden="true" />
          <span>Context</span>
        </button>
      </div>
    </header>
  );
}
