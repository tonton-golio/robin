'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPage } from '@/lib/actions/page';
import { vaultPageHref } from '@/lib/routes';
import { useActiveDocument } from './ActiveDocumentProvider';
import {
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * ⌘N create-page dialog — the primary create path (replaces the /new route).
 *
 * Opened by LivingWorkspaceShell on ⌘N or a `robin:create` event from the
 * command palette. A type-driven scaffold uses the createPage server action;
 * on success it routes to the new page's reader.
 */

interface Kind {
  id: string;
  label: string;
  folder: 'brain' | 'out';
}

// The chosen kind drives both the frontmatter `type` and the target folder:
// shareable deliverables land in out/, durable knowledge in brain/.
const KINDS: Kind[] = [
  { id: 'note', label: 'Note', folder: 'brain' },
  { id: 'knowledge', label: 'Knowledge', folder: 'brain' },
  { id: 'person', label: 'Person', folder: 'brain' },
  { id: 'project', label: 'Project', folder: 'brain' },
  { id: 'meeting', label: 'Meeting', folder: 'brain' },
  { id: 'report', label: 'Report', folder: 'out' },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}

export function CreatePageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { requestNavigation } = useActiveDocument();
  const [title, setTitle] = useState('');
  const [kindId, setKindId] = useState('note');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const kind = KINDS.find((k) => k.id === kindId) ?? KINDS[0]!;
  const slug = useMemo(() => slugify(title), [title]);
  const previewPath = `${kind.folder}/${slug || 'untitled'}.html`;

  // Reset on close so the next open starts clean.
  useEffect(() => {
    if (!open) {
      setTitle('');
      setKindId('note');
      setSummary('');
      setError('');
      setCreating(false);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) {
      setError('A title is required.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const result = await createPage({
        folder: kind.folder,
        slug,
        type: kind.id,
        frontmatter: { type: kind.id, title: title.trim(), summary: summary.trim() || undefined },
        blocks: [{ kind: 'heading', level: 1, content: [{ kind: 'text', text: title.trim() || slug }] }],
      });
      if (!result.ok) {
        setError(
          result.error === 'conflict'
            ? `"${slug}" already exists in ${kind.folder}.`
            : (result.error ?? 'Failed to create page.'),
        );
        setCreating(false);
        return;
      }
      onOpenChange(false);
      requestNavigation(vaultPageHref(result.path ?? previewPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create page.');
      setCreating(false);
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="robin-create-dialog-overlay" />
        <DialogContent
          className="robin-create-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <form onSubmit={(event) => void submit(event)}>
            <DialogHeader className="robin-create-dialog-head">
              <div>
                <DialogTitle>New page</DialogTitle>
                <DialogDescription>
                  Create a durable file in the archive.
                </DialogDescription>
              </div>
              <DialogCloseButton label="Close new page dialog" />
            </DialogHeader>
            <DialogBody className="robin-create-dialog-body">
          <div>
            <label className="robin-create-dialog-label" htmlFor="robin-create-title">
              Title
            </label>
            <input
              id="robin-create-title"
              ref={inputRef}
              className="robin-create-dialog-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled page"
              autoComplete="off"
              style={{ marginTop: 6 }}
            />
          </div>

          <div>
            <div className="robin-create-dialog-label" style={{ marginBottom: 6 }}>
              Kind
            </div>
            <div className="robin-create-dialog-kinds" role="group" aria-label="Page kind">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className="robin-create-dialog-kind"
                  aria-pressed={k.id === kindId}
                  onClick={() => setKindId(k.id)}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="robin-create-dialog-label" htmlFor="robin-create-summary">
              Summary <span style={{ opacity: 0.7 }}>(optional)</span>
            </label>
            <input
              id="robin-create-summary"
              className="robin-create-dialog-input"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="One-line summary"
              autoComplete="off"
              style={{ marginTop: 6 }}
            />
          </div>

          <div className="robin-create-dialog-path" aria-live="polite">
            {error ? <span style={{ color: 'var(--red)' }}>{error}</span> : previewPath}
          </div>
            </DialogBody>
            <DialogFooter className="robin-create-dialog-foot">
              <button
                type="button"
                className="r-btn r-btn--ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </button>
              <button type="submit" className="r-btn r-btn--primary" disabled={creating || !slug}>
                {creating ? 'Creating…' : 'Create'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
