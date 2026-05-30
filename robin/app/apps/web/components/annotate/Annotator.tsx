'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Highlighter, MessageSquare, ArrowUpRight, Sparkles } from 'lucide-react';
import {
  DEFAULT_ANNOTATION_COLOR,
  type AnnotationAnchor,
  type AnnotationRecord,
} from '@/lib/annotations';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

type Anchor = AnnotationAnchor;

function pagePathFromRoute(pathname: string): string | null {
  // Annotator is only meaningful on rendered vault pages
  // (brain/, logs/, out/). Old /p/<path> URLs are now legacy redirects, so
  // by the time the annotator runs the URL is the clean canonical form.
  const isVaultPage =
    pathname.startsWith('/brain/') ||
    pathname.startsWith('/logs/') ||
    pathname.startsWith('/out/');
  if (!isVaultPage) return null;
  const rel = decodeURIComponent(pathname.slice(1));
  if (!rel) return null;
  // Logs route /_logs/... is the changelog/repo-log viewer, not an annotatable page.
  if (rel.startsWith('_logs/')) return null;
  return rel.endsWith('.html') ? rel : `${rel}.html`;
}

function getContainer(): HTMLElement | null {
  return (
    document.querySelector('[data-robin-annotate-root]') as HTMLElement | null
  ) ?? (document.querySelector('.robin-prose') as HTMLElement | null);
}

function computeOffsets(root: HTMLElement, range: Range): { start: number; end: number } | null {
  const fullText = root.textContent ?? '';
  if (!fullText) return null;
  // walk text nodes and accumulate offsets
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let acc = 0;
  let startOffset = -1;
  let endOffset = -1;
  let node = walker.nextNode();
  while (node) {
    const len = (node as Text).data.length;
    if (node === range.startContainer && startOffset === -1) {
      startOffset = acc + range.startOffset;
    }
    if (node === range.endContainer) {
      endOffset = acc + range.endOffset;
      break;
    }
    acc += len;
    node = walker.nextNode();
  }
  if (startOffset === -1 || endOffset === -1) return null;
  return { start: Math.min(startOffset, endOffset), end: Math.max(startOffset, endOffset) };
}

function rangeFromOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let acc = 0;
  let startNode: Text | null = null;
  let startNodeOffset = 0;
  let endNode: Text | null = null;
  let endNodeOffset = 0;
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const len = text.data.length;
    if (!startNode && acc + len >= start) {
      startNode = text;
      startNodeOffset = start - acc;
    }
    if (acc + len >= end) {
      endNode = text;
      endNodeOffset = end - acc;
      break;
    }
    acc += len;
    node = walker.nextNode();
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  try {
    range.setStart(startNode, Math.max(0, Math.min(startNodeOffset, startNode.data.length)));
    range.setEnd(endNode, Math.max(0, Math.min(endNodeOffset, endNode.data.length)));
  } catch {
    return null;
  }
  return range;
}

function applyHighlightRange(range: Range, color: string | undefined, id: string): void {
  const mark = document.createElement('mark');
  mark.className = 'robin-highlight';
  mark.dataset.color = color ?? DEFAULT_ANNOTATION_COLOR;
  mark.dataset.annId = id;
  try {
    range.surroundContents(mark);
  } catch {
    // Fallback: wrap each text node fragment individually
    const fragment = range.cloneContents();
    mark.appendChild(fragment);
    range.deleteContents();
    range.insertNode(mark);
  }
}

function reanchor(root: HTMLElement, anchor: Anchor): Range | null {
  // Prefer text_quote with prefix/suffix
  const text = root.textContent ?? '';
  const { exact, prefix, suffix } = anchor.text_quote;
  if (exact) {
    const needle = `${prefix}${exact}${suffix}`;
    const idx = text.indexOf(needle);
    if (idx !== -1) {
      const start = idx + prefix.length;
      const end = start + exact.length;
      const r = rangeFromOffsets(root, start, end);
      if (r) return r;
    }
    const idx2 = text.indexOf(exact);
    if (idx2 !== -1) {
      return rangeFromOffsets(root, idx2, idx2 + exact.length);
    }
  }
  if (anchor.text_position) {
    return rangeFromOffsets(root, anchor.text_position.start, anchor.text_position.end);
  }
  return null;
}

export function Annotator({ pathname }: { pathname: string }) {
  const pagePath = useMemo(() => pagePathFromRoute(pathname), [pathname]);
  const containerRef = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<{
    rect: DOMRect;
    anchor: Anchor;
  } | null>(null);
  const [editor, setEditor] = useState<{ anchor: Anchor; rect: DOMRect } | null>(null);
  const [comment, setComment] = useState('');
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  // Toast carries a kind so failed saves render the error (rust) border
  // instead of looking identical to a success confirmation.
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  // In-flight guard: a double-click would otherwise POST twice and create
  // two distinct annotation events for the same selection.
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!pagePath) return;
    try {
      const res = await fetch(`/api/annotations?page_path=${encodeURIComponent(pagePath)}`);
      if (!res.ok) return;
      const data = await res.json();
      setAnnotations(Array.isArray(data.annotations) ? data.annotations : []);
    } catch {
      // ignore
    }
  }, [pagePath]);

  // Locate container after mount
  useEffect(() => {
    if (!pagePath) return;
    let attempts = 0;
    const find = () => {
      const c = getContainer();
      if (c) {
        containerRef.current = c;
        refresh();
      } else if (attempts < 15) {
        attempts += 1;
        setTimeout(find, 200);
      }
    };
    find();
  }, [pagePath, refresh]);

  // Apply highlights once annotations + container ready
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    // Clear previous highlights
    root.querySelectorAll('mark.robin-highlight').forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    });
    root.normalize();
    if (annotations.length === 0) return;
    for (const ann of annotations) {
      if (!ann.anchor) continue;
      const range = reanchor(root, ann.anchor);
      if (range && !range.collapsed) {
        applyHighlightRange(range, ann.color, ann.id);
      }
    }
  }, [annotations]);

  // Listen for selection
  useEffect(() => {
    if (!pagePath) return;
    function handler() {
      const root = containerRef.current;
      if (!root) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      // Clear any visible toolbar when the selection shrinks below threshold
      // mid-drag, otherwise it floats with a stale (now-invalid) anchor.
      if (rect.width < 1) {
        setSelection(null);
        return;
      }
      const exact = sel.toString();
      if (exact.length < 2) {
        setSelection(null);
        return;
      }
      const offsets = computeOffsets(root, range);
      if (!offsets) {
        setSelection(null);
        return;
      }
      const fullText = root.textContent ?? '';
      const prefix = fullText.slice(Math.max(0, offsets.start - 32), offsets.start);
      const suffix = fullText.slice(offsets.end, offsets.end + 32);
      setSelection({
        rect,
        anchor: {
          block_path: [],
          text_quote: { exact, prefix, suffix },
          text_position: offsets,
        },
      });
    }
    document.addEventListener('mouseup', handler);
    document.addEventListener('selectionchange', handler);
    return () => {
      document.removeEventListener('mouseup', handler);
      document.removeEventListener('selectionchange', handler);
    };
  }, [pagePath]);

  async function save(kind: 'highlight' | 'comment', commentMd: string, anchor: Anchor) {
    if (!pagePath || !anchor) return;
    // Guard against double-submit (double-click / impatient click on a slow fs)
    // which would append two distinct annotation events for one selection.
    if (saving) return;
    setSaving(true);
    const body = {
      page_path: pagePath,
      render_path: pagePath,
      kind,
      comment_md: commentMd,
      anchor,
    };
    try {
      const res = await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('save failed');
      setSelection(null);
      setEditor(null);
      setComment('');
      window.getSelection()?.removeAllRanges();
      setToast({ message: kind === 'highlight' ? 'Highlighted' : 'Comment saved', kind: 'success' });
      setTimeout(() => setToast(null), 1800);
      refresh();
    } catch (err) {
      setToast({ message: `Save failed: ${(err as Error).message}`, kind: 'error' });
      setTimeout(() => setToast(null), 2400);
    } finally {
      setSaving(false);
    }
  }

  if (!pagePath) return null;

  return (
    <>
      {selection && !editor && (
        <div
          role="toolbar"
          aria-label="Annotate selection"
          className="absolute z-50 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-lg"
          onMouseDown={(event) => event.preventDefault()}
          style={{
            top: Math.max(window.scrollY + selection.rect.top - 44, 60),
            left: Math.min(
              window.scrollX + selection.rect.left + selection.rect.width / 2 - 110,
              window.innerWidth - 240,
            ),
          }}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => save('highlight', '', selection.anchor)}
            title="Highlight selection"
          >
            <Highlighter size={14} strokeWidth={1.5} /> highlight
          </Button>
          <div className="h-[18px] w-px bg-border" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => setEditor({ anchor: selection.anchor, rect: selection.rect })}
            title="Add comment"
          >
            <MessageSquare size={14} strokeWidth={1.5} /> comment
          </Button>
        </div>
      )}

      {editor && (
        <div
          role="dialog"
          aria-label="Add a comment"
          className="fixed z-[60] w-80 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
          style={{
            // position: fixed resolves against the viewport, and editor.rect is
            // already viewport-relative (getBoundingClientRect). Adding scrollX
            // here (unlike the position:absolute toolbar above) would shove the
            // dialog right by the horizontal scroll amount. Match the top calc,
            // which correctly omits scrollY.
            top: Math.max(editor.rect.bottom + 16, 80),
            left: Math.min(editor.rect.left, window.innerWidth - 340),
          }}
        >
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            // Keyboard support: Escape dismisses, Cmd/Ctrl+Enter saves —
            // otherwise this capture flow is mouse-only.
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditor(null);
                setComment('');
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!saving) save('comment', comment, editor.anchor);
              }
            }}
            placeholder="Add a comment…"
            autoFocus
            className={cn(
              'min-h-[118px] w-full resize-y rounded-md border border-border bg-background',
              'px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none',
              'placeholder:text-muted-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/30',
            )}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                setEditor(null);
                setComment('');
              }}
            >
              cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => save('comment', comment, editor.anchor)}
            >
              <Sparkles size={12} strokeWidth={1.5} /> save
            </Button>
          </div>
        </div>
      )}

      {annotations.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 70,
            right: 16,
            zIndex: 30,
            background: 'var(--bg-1)',
            border: '1px solid var(--border-0)',
            borderRadius: 8,
            padding: '6px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-1)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Highlighter size={12} strokeWidth={1.5} /> {annotations.length}{' '}
          {annotations.length === 1 ? 'note' : 'notes'}
        </div>
      )}

      {toast && (
        <div
          className="robin-toast"
          data-kind={toast.kind}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
        >
          <ArrowUpRight size={14} strokeWidth={1.5} style={{ marginRight: 8, verticalAlign: 'middle' }} />
          {toast.message}
        </div>
      )}
    </>
  );
}
