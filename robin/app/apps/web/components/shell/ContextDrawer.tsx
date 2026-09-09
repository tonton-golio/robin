'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useActiveDocument } from './ActiveDocumentProvider';
import { WorkspaceLink } from './WorkspaceLink';
import { vaultPageHref } from '@/lib/routes';
import {
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetRoot,
  SheetTitle,
} from '@/components/ui/sheet';

interface ContextEdit {
  id?: string;
  ts?: string;
  origin?: string;
  actor?: string;
  tool?: string;
  summary?: string;
}

interface ContextRef {
  page?: { path?: string; title?: string; type?: string };
  target?: { path?: string; title?: string };
  via?: { title?: string };
  reason?: string;
  matchedText?: string;
}

interface ContextConnections {
  backlinks?: ContextRef[];
  outbound?: ContextRef[];
  trails?: ContextRef[];
  suggestions?: ContextRef[];
  mode?: string;
}

interface HeadingRef {
  id: string;
  text: string;
  level: number;
}

function stateLabel(kind: string | undefined) {
  if (!kind) return 'Live workspace';
  return kind.replace('-', ' ');
}

export function ContextDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { document: activeDocument } = useActiveDocument();
  const path = activeDocument?.path ?? '';
  const fileBacked = /\.(html|md|jsonl|txt|pdf)$/i.test(path);
  const [edits, setEdits] = useState<ContextEdit[]>([]);
  const [connections, setConnections] = useState<ContextConnections | null>(null);
  const [headings, setHeadings] = useState<HeadingRef[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const root = documentQueryRoot();
    const nextHeadings = root
      ? Array.from(root.querySelectorAll<HTMLElement>('h2, h3')).map((heading, index) => {
          if (!heading.id) heading.id = `context-section-${index + 1}`;
          return {
            id: heading.id,
            text: heading.textContent?.trim() || `Section ${index + 1}`,
            level: heading.tagName === 'H3' ? 3 : 2,
          };
        })
      : [];
    setHeadings(nextHeadings);
  }, [open, path]);

  useEffect(() => {
    if (!open || !fileBacked) {
      setEdits([]);
      setConnections(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    const load = async () => {
      const [editResponse, connectionResponse] = await Promise.allSettled([
        fetch(`/api/edits?path=${encodeURIComponent(path)}&limit=6`, {
          signal: controller.signal,
        }),
        path.endsWith('.html')
          ? fetch(`/api/connections?path=${encodeURIComponent(path)}`, {
              signal: controller.signal,
            })
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (editResponse.status === 'fulfilled' && editResponse.value.ok) {
        const body = (await editResponse.value.json()) as { edits?: ContextEdit[] };
        setEdits(Array.isArray(body.edits) ? body.edits : []);
      } else {
        setEdits([]);
      }
      if (
        connectionResponse.status === 'fulfilled' &&
        connectionResponse.value &&
        connectionResponse.value.ok
      ) {
        setConnections((await connectionResponse.value.json()) as ContextConnections);
      } else {
        setConnections(null);
      }
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fileBacked, open, path]);

  const connectionRows = useMemo(() => {
    const rows: { key: string; title: string; meta: string; href?: string }[] = [];
    for (const [kind, refs] of Object.entries({
      Backlink: connections?.backlinks ?? [],
      'Linked out': connections?.outbound ?? [],
      Trail: connections?.trails ?? [],
      Mention: connections?.suggestions ?? [],
    })) {
      for (const [index, ref] of refs.entries()) {
        const target = ref.page ?? ref.target;
        rows.push({
          key: `${kind}-${index}-${target?.path ?? ref.matchedText ?? ''}`,
          title: target?.title ?? ref.matchedText ?? kind,
          meta: [kind, ref.page?.type, ref.reason, ref.via?.title].filter(Boolean).join(' · '),
          href: target?.path ? vaultPageHref(target.path) : undefined,
        });
      }
    }
    return rows.slice(0, 12);
  }, [connections]);

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        id="workspace-context-sheet"
        className="workspace-context-sheet"
      >
        <div className="workspace-sheet-header">
          <div>
            <SheetTitle>Context</SheetTitle>
            <SheetDescription>
              Source, outline, connections, and recent writes.
            </SheetDescription>
          </div>
          <SheetClose type="button" className="workspace-icon-button" aria-label="Close context">
            <X size={18} strokeWidth={1.7} aria-hidden="true" />
          </SheetClose>
        </div>

        <div className="workspace-context-scroll">
          <section className="workspace-context-section">
            <h3>Active source</h3>
            <p className="workspace-context-path">{path || 'No file selected'}</p>
            <p className="workspace-context-state">
              <span className="workspace-write-dot" data-state={activeDocument?.writeState.kind ?? 'live'} />
              {activeDocument?.mode === 'edit' ? 'Editing · ' : ''}
              {stateLabel(activeDocument?.writeState.kind)}
            </p>
            {activeDocument?.updatedAt ? (
              <p className="workspace-context-detail">
                Updated {new Date(activeDocument.updatedAt).toLocaleString()}
              </p>
            ) : null}
            {activeDocument?.writeState.kind === 'conflict' ||
            activeDocument?.writeState.kind === 'error' ? (
              <p className="workspace-context-error" role="alert">
                {activeDocument.writeState.message}
              </p>
            ) : null}
          </section>

          {headings.length > 0 ? (
            <section className="workspace-context-section">
              <h3>Outline</h3>
              <nav aria-label="Document outline">
                {headings.map((heading) => (
                  <button
                    key={heading.id}
                    type="button"
                    className="workspace-context-row"
                    data-level={heading.level}
                    onClick={() => {
                      window.document
                        .getElementById(heading.id)
                        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                      onOpenChange(false);
                    }}
                  >
                    {heading.text}
                  </button>
                ))}
              </nav>
            </section>
          ) : null}

          {connectionRows.length > 0 ? (
            <section className="workspace-context-section">
              <h3>Connections</h3>
              {connectionRows.map((row) =>
                row.href ? (
                  <WorkspaceLink
                    key={row.key}
                    href={row.href}
                    className="workspace-context-link"
                    onNavigateStart={() => onOpenChange(false)}
                  >
                    <span>{row.title}</span>
                    <small>{row.meta}</small>
                  </WorkspaceLink>
                ) : (
                  <div key={row.key} className="workspace-context-link">
                    <span>{row.title}</span>
                    <small>{row.meta}</small>
                  </div>
                ),
              )}
            </section>
          ) : null}

          <section className="workspace-context-section">
            <h3>Recent writes</h3>
            {loading ? <p className="workspace-context-empty">Loading history…</p> : null}
            {!loading && edits.length === 0 ? (
              <p className="workspace-context-empty">No writes recorded for this source.</p>
            ) : null}
            {edits.map((edit, index) => (
              <div className="workspace-context-edit" key={edit.id ?? `${edit.ts}-${index}`}>
                <span>{edit.summary || edit.tool || 'File updated'}</span>
                <small>
                  {[edit.actor || edit.origin, edit.tool, edit.ts ? new Date(edit.ts).toLocaleString() : null]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </div>
            ))}
          </section>
        </div>
      </SheetContent>
    </SheetRoot>
  );
}

function documentQueryRoot(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-robin-annotate-root]') ??
    document.querySelector<HTMLElement>('#workspace-main')
  );
}
