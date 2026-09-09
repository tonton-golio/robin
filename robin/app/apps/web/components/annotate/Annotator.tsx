'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Highlighter, MessageSquare } from 'lucide-react';
import {
  DEFAULT_ANNOTATION_COLOR,
  isClosedAnnotationStatus,
  type AnnotationAnchor,
  type AnnotationRecord,
} from '@/lib/annotations';

/**
 * Annotations as a conversation.
 *
 * Mounted once by the shell for every rendered vault page. Three surfaces:
 *   1. a selection toolbar (highlight / comment) — an Human write, ink-styled;
 *   2. a real role="dialog" popover that opens on a highlight and holds the
 *      thread (comment + replies, each with actor + timestamp; Robin replies
 *      marked ▪), a reply box (⌘↵ posts), and the Resolve / Needs attention /
 *      Reject state group — repositioned against the live anchor rect on scroll,
 *      flipped above when it would overflow the viewport bottom;
 *   3. an unanchored-notes tray listing annotations whose anchor no longer
 *      resolves against the current text (Robin rewrote the paragraph), so a
 *      note is never silently lost.
 *
 * Everything is append-only (brain/memory/annotations.jsonl): a reply is a new
 * comment on the same anchor; a state change PATCHes the thread's id. Readers
 * dedupe by id and render the latest state.
 */

type Anchor = AnnotationAnchor;

function pagePathFromRoute(pathname: string): string | null {
  const isVaultPage =
    pathname.startsWith('/brain/') || pathname.startsWith('/logs/') || pathname.startsWith('/out/');
  if (!isVaultPage) return null;
  const rel = decodeURIComponent(pathname.slice(1));
  if (!rel || rel.startsWith('_logs/')) return null;
  return rel.endsWith('.html') ? rel : `${rel}.html`;
}

function getContainer(): HTMLElement | null {
  return (
    (document.querySelector('[data-robin-annotate-root]') as HTMLElement | null) ??
    (document.querySelector('.robin-prose') as HTMLElement | null)
  );
}

function computeOffsets(root: HTMLElement, range: Range): { start: number; end: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let acc = 0;
  let startOffset = -1;
  let endOffset = -1;
  let node = walker.nextNode();
  while (node) {
    const len = (node as Text).data.length;
    if (node === range.startContainer && startOffset === -1) startOffset = acc + range.startOffset;
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

function applyHighlightRange(range: Range, ann: AnnotationRecord): void {
  const mark = document.createElement('mark');
  mark.className = 'robin-highlight';
  mark.dataset.color = ann.color ?? DEFAULT_ANNOTATION_COLOR;
  mark.dataset.annId = ann.id;
  mark.dataset.status = ann.status;
  try {
    range.surroundContents(mark);
  } catch {
    const fragment = range.cloneContents();
    mark.appendChild(fragment);
    range.deleteContents();
    range.insertNode(mark);
  }
}

/** Returns the range for an anchor, or null when it can no longer resolve. */
function reanchor(root: HTMLElement, anchor: Anchor | undefined): Range | null {
  if (!anchor) return null;
  const text = root.textContent ?? '';
  const { exact, prefix, suffix } = anchor.text_quote;
  if (exact) {
    const needle = `${prefix}${exact}${suffix}`;
    const idx = text.indexOf(needle);
    if (idx !== -1) {
      const start = idx + prefix.length;
      return rangeFromOffsets(root, start, start + exact.length);
    }
    const idx2 = text.indexOf(exact);
    if (idx2 !== -1) return rangeFromOffsets(root, idx2, idx2 + exact.length);
  }
  if (anchor.text_position) return rangeFromOffsets(root, anchor.text_position.start, anchor.text_position.end);
  return null;
}

function relTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function isRobin(author?: string): boolean {
  return !!author && /robin/i.test(author);
}

export function Annotator({ pathname }: { pathname: string }) {
  const pagePath = useMemo(() => pagePathFromRoute(pathname), [pathname]);
  const containerRef = useRef<HTMLElement | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [unanchored, setUnanchored] = useState<AnnotationRecord[]>([]);
  const [selection, setSelection] = useState<{ rect: DOMRect; anchor: Anchor } | null>(null);
  const [composing, setComposing] = useState<{ rect: DOMRect; anchor: Anchor } | null>(null);
  const [dialog, setDialog] = useState<{ annId: string } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const [comment, setComment] = useState('');
  const [reply, setReply] = useState('');
  const [saving, setSaving] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const anchorElRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    if (!pagePath) return;
    try {
      const res = await fetch(`/api/annotations?page_path=${encodeURIComponent(pagePath)}`);
      if (!res.ok) return;
      const data = await res.json();
      setAnnotations(Array.isArray(data.annotations) ? data.annotations : []);
    } catch {
      /* ignore */
    }
  }, [pagePath]);

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

  // Apply highlights; collect ones whose anchor no longer resolves.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.querySelectorAll('mark.robin-highlight').forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    });
    root.normalize();
    const orphans: AnnotationRecord[] = [];
    for (const ann of annotations) {
      const range = reanchor(root, ann.anchor);
      if (range && !range.collapsed) applyHighlightRange(range, ann);
      else if (ann.anchor) orphans.push(ann);
    }
    setUnanchored(orphans);
  }, [annotations]);

  // Selection → toolbar.
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
      setSelection({ rect, anchor: { block_path: [], text_quote: { exact, prefix, suffix }, text_position: offsets } });
    }
    document.addEventListener('mouseup', handler);
    document.addEventListener('selectionchange', handler);
    return () => {
      document.removeEventListener('mouseup', handler);
      document.removeEventListener('selectionchange', handler);
    };
  }, [pagePath]);

  // Click a highlight → open the conversation dialog anchored to it.
  useEffect(() => {
    if (!pagePath) return;
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const mark = target?.closest<HTMLElement>('mark.robin-highlight');
      if (!mark) return;
      const annId = mark.dataset.annId;
      if (!annId) return;
      anchorElRef.current = mark;
      setSelection(null);
      setDialog({ annId });
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [pagePath]);

  // Reposition the dialog against the live anchor rect (scroll / resize) with an
  // edge-flip above when it would overflow the viewport bottom.
  useEffect(() => {
    if (!dialog) {
      setPos(null);
      return;
    }
    function place() {
      const el = anchorElRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dialogH = 300;
      const below = r.bottom + dialogH < window.innerHeight;
      const top = below ? r.bottom + 8 : Math.max(8, r.top - dialogH - 8);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - 372);
      setPos({ top, left, above: !below });
    }
    place();
    replyRef.current?.focus();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [dialog]);

  // Esc closes whatever is open; focus returns to the anchor.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (dialog) {
        setDialog(null);
        anchorElRef.current?.focus?.();
      }
      setComposing(null);
      setComment('');
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog]);

  async function post(kind: 'highlight' | 'comment', commentMd: string, anchor: Anchor): Promise<boolean> {
    if (!pagePath || saving) return false;
    setSaving(true);
    try {
      const res = await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ page_path: pagePath, render_path: pagePath, kind, comment_md: commentMd, anchor }),
      });
      if (!res.ok) throw new Error('save failed');
      window.getSelection()?.removeAllRanges();
      await refresh();
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, status: string): Promise<void> {
    if (!pagePath) return;
    setSaving(true);
    try {
      await fetch('/api/annotations', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, status, page_path: pagePath, render_path: pagePath, resolution_md: `Marked ${status}.` }),
      });
      await refresh();
      setDialog(null);
    } finally {
      setSaving(false);
    }
  }

  if (!pagePath) return null;

  // The thread for the open dialog = annotations sharing the anchor exact.
  const rootAnn = dialog ? annotations.find((a) => a.id === dialog.annId) ?? null : null;
  const thread = rootAnn
    ? annotations
        .filter((a) => a.anchor?.text_quote.exact === rootAnn.anchor?.text_quote.exact)
        .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    : [];

  return (
    <>
      {/* selection toolbar */}
      {selection && !composing && !dialog && (
        <div
          role="toolbar"
          aria-label="Annotate selection"
          className="r-anno-toolbar"
          onMouseDown={(e) => e.preventDefault()}
          style={{
            top: Math.max(window.scrollY + selection.rect.top - 42, 56),
            left: Math.min(window.scrollX + selection.rect.left, window.innerWidth - 220),
          }}
        >
          <button
            type="button"
            className="r-anno-tool-btn"
            disabled={saving}
            onClick={() => post('highlight', '', selection.anchor)}
          >
            <Highlighter size={13} strokeWidth={1.6} /> highlight
          </button>
          <button
            type="button"
            className="r-anno-tool-btn"
            disabled={saving}
            onClick={() => setComposing({ rect: selection.rect, anchor: selection.anchor })}
          >
            <MessageSquare size={13} strokeWidth={1.6} /> comment
          </button>
        </div>
      )}

      {/* compose a new comment */}
      {composing && (
        <div
          role="dialog"
          aria-label="Add a comment"
          className="r-anno-dialog"
          style={{
            top: Math.min(composing.rect.bottom + 8, window.innerHeight - 200),
            left: Math.min(composing.rect.left, window.innerWidth - 372),
          }}
        >
          <div className="ahead">
            <span className="r-bar">Comment</span>
            <button
              type="button"
              className="aclose"
              aria-label="Close"
              onClick={() => {
                setComposing(null);
                setComment('');
              }}
            >
              ✕
            </button>
          </div>
          <div className="r-anno-foot">
            <textarea
              autoFocus
              value={comment}
              placeholder="Add a comment…"
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void post('comment', comment, composing.anchor).then((ok) => {
                    if (ok) {
                      setComposing(null);
                      setComment('');
                    }
                  });
                }
              }}
            />
            <div className="r-anno-actions">
              <button
                type="button"
                className="r-anno-state"
                disabled={saving || !comment.trim()}
                onClick={() =>
                  void post('comment', comment, composing.anchor).then((ok) => {
                    if (ok) {
                      setComposing(null);
                      setComment('');
                    }
                  })
                }
              >
                Post (⌘↵)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* conversation dialog on an existing highlight */}
      {dialog && rootAnn && pos && (
        <div
          role="dialog"
          aria-label="Annotation thread"
          className={`r-anno-dialog ${pos.above ? 'above' : 'below'}`}
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="ahead">
            <span className="r-bar">Note</span>
            <button
              type="button"
              className="aclose"
              aria-label="Close"
              onClick={() => {
                setDialog(null);
                anchorElRef.current?.focus?.();
              }}
            >
              ✕
            </button>
          </div>
          <div className="r-anno-body">
            {rootAnn.anchor?.text_quote.exact ? (
              <div className="quote">“{rootAnn.anchor.text_quote.exact}”</div>
            ) : null}
            {thread.map((a) => (
              <div className="r-anno-reply" key={a.id}>
                <div className="who">
                  <span className="actor">
                    {isRobin(a.author) ? '▪ ' : ''}
                    {a.author ?? 'human'}
                  </span>
                  <span>{relTime(a.created_at)}</span>
                  {isClosedAnnotationStatus(a.status) ? <span>· {a.status}</span> : null}
                </div>
                {a.comment_md ? <div className="txt">{a.comment_md}</div> : <div className="txt">(highlight)</div>}
              </div>
            ))}
          </div>
          <div className="r-anno-foot">
            <textarea
              ref={replyRef}
              value={reply}
              placeholder="Reply…"
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && rootAnn.anchor) {
                  e.preventDefault();
                  void post('comment', reply, rootAnn.anchor).then((ok) => {
                    if (ok) setReply('');
                  });
                }
              }}
            />
            <div className="r-anno-actions">
              <button
                type="button"
                className="r-anno-state"
                disabled={saving}
                onClick={() => void setStatus(rootAnn.id, 'resolved')}
              >
                Resolve
              </button>
              <button
                type="button"
                className="r-anno-state"
                disabled={saving}
                onClick={() => void setStatus(rootAnn.id, 'needs-attention')}
              >
                Needs attention
              </button>
              <button
                type="button"
                className="r-anno-state reject"
                disabled={saving}
                onClick={() => void setStatus(rootAnn.id, 'rejected')}
              >
                Reject
              </button>
            </div>
            <div className="m">append-only · a reply or state change appends a same-id event; nothing is deleted.</div>
          </div>
        </div>
      )}

      {/* unanchored-notes tray */}
      {unanchored.length > 0 && !dialog && (
        <div className="r-anno-tray" role="complementary" aria-label="Unanchored notes">
          <div className="r-anno-tray-head">
            <Highlighter size={12} strokeWidth={1.6} />
            {unanchored.length} unanchored {unanchored.length === 1 ? 'note' : 'notes'}
          </div>
          <div className="r-anno-tray-body">
            {unanchored.map((a) => (
              <div className="r-anno-tray-item" key={a.id}>
                {a.anchor?.text_quote.exact ? <div className="q">“{a.anchor.text_quote.exact}”</div> : null}
                {a.comment_md ? <div>{a.comment_md}</div> : null}
                <div className="r-anno-actions">
                  <button
                    type="button"
                    className="r-anno-state"
                    disabled={saving}
                    onClick={() => void setStatus(a.id, 'resolved')}
                  >
                    Resolve
                  </button>
                  <button
                    type="button"
                    className="r-anno-state reject"
                    disabled={saving}
                    onClick={() => void setStatus(a.id, 'rejected')}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
