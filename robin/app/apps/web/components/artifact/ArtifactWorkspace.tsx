'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  MessageSquare,
  ExternalLink,
  Download,
  Presentation,
  FileText,
  Printer,
  X,
  MapPin,
  Highlighter,
} from 'lucide-react';
import {
  DEFAULT_ANNOTATION_COLOR,
  type AnnotationAnchor,
  type AnnotationRecord,
  type SlidePin,
} from '@/lib/annotations';

const DECK_W = 1200;
const DECK_H = 675;

type Anchor = AnnotationAnchor;

interface Props {
  title: string;
  filePath: string;
  pagePath: string;
  fileUrl: string;
  mtime: string;
}

function computeOffsets(root: HTMLElement, range: Range): { start: number; end: number } | null {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
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

export function ArtifactWorkspace({ title, filePath, pagePath, fileUrl, mtime }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const [isDeck, setIsDeck] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [slideCount, setSlideCount] = useState(0);
  const [slideTitles, setSlideTitles] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [scale, setScale] = useState(1);
  const [stageW, setStageW] = useState(0);

  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [railOpen, setRailOpen] = useState(true);
  const [pinMode, setPinMode] = useState(false);
  const [draft, setDraft] = useState<{ pin?: SlidePin; anchor?: Anchor; rect?: DOMRect } | null>(null);
  const [comment, setComment] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  // Gate locale-formatted time to after mount — toLocaleString() differs
  // between the Node server and the browser and would cause a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/annotations?page_path=${encodeURIComponent(pagePath)}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setAnnotations(Array.isArray(data.annotations) ? data.annotations : []);
    } catch {
      /* ignore */
    }
  }, [pagePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const deckDoc = useCallback((): Document | null => {
    try {
      return frameRef.current?.contentDocument ?? null;
    } catch {
      return null;
    }
  }, []);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const w = stage.clientWidth - 8;
    setStageW(w);
    if (isDeck) setScale(Math.min(1.6, w / DECK_W));
  }, [isDeck]);

  const setupDeck = useCallback((doc: Document, slides: Element[]) => {
    doc.documentElement.setAttribute('data-robin-embed', '');
    if (!doc.querySelector('link[href="/robin-deck.css"]')) {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/robin-deck.css';
      doc.head.appendChild(link);
    }
    setIsDeck(true);
    setSlideCount(slides.length);
    setSlideTitles(
      slides.map((s) => {
        const h = s.querySelector('h1, h2');
        const eb = s.querySelector('.eyebrow');
        return ((h?.textContent || eb?.textContent || '') as string).trim();
      }),
    );
    const win = frameRef.current?.contentWindow as (Window & { robinDeck?: { index: number } }) | null;
    setCurrent(win?.robinDeck?.index ?? 0);
    doc.addEventListener('robin-deck:change', ((e: CustomEvent) => {
      setCurrent(e.detail.index);
    }) as EventListener);
  }, []);

  useEffect(() => {
    fit();
    window.addEventListener('resize', fit);
    const onFs = () => setTimeout(fit, 0);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('resize', fit);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [fit, loaded]);

  // The iframe is server-rendered with src already set, so the load event is
  // unreliable (often missed, or fires on a transient about:blank). Poll the
  // contentDocument until the real artifact is positively identified.
  useEffect(() => {
    if (loaded) return undefined;
    let stop = false;
    let tries = 0;
    const tick = () => {
      if (stop) return;
      const doc = deckDoc();
      const ready = doc && doc.readyState === 'complete';
      const slides = doc ? Array.from(doc.querySelectorAll('.slide')) : [];
      if (slides.length > 0) {
        setupDeck(doc!, slides);
        setLoaded(true);
        setTimeout(fit, 0);
        return;
      }
      if (ready && (doc!.body?.childElementCount ?? 0) > 0) {
        setIsDeck(false);
        setLoaded(true);
        setTimeout(fit, 0);
        return;
      }
      if (tries < 60) {
        tries += 1;
        setTimeout(tick, 100);
      }
    };
    tick();
    return () => {
      stop = true;
    };
  }, [loaded, deckDoc, setupDeck, fit]);

  const go = useCallback(
    (i: number) => {
      const win = frameRef.current?.contentWindow as (Window & { robinDeck?: { show: (n: number) => void } }) | null;
      win?.robinDeck?.show(i);
      setCurrent(i);
    },
    [],
  );

  // Keyboard nav for decks.
  useEffect(() => {
    if (!isDeck) return;
    function onKey(e: KeyboardEvent) {
      if (draft) return;
      if (e.key === 'ArrowRight') go(current + 1);
      else if (e.key === 'ArrowLeft') go(current - 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDeck, current, go, draft]);

  useEffect(() => {
    if (!pinMode && !draft) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setDraft(null);
      setPinMode(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinMode, draft]);

  // Text selection → comment, for document artifacts.
  useEffect(() => {
    if (isDeck || !loaded) return;
    const doc = deckDoc();
    if (!doc) return;
    function handler() {
      const sel = doc!.getSelection();
      if (!sel || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const exact = sel.toString();
      if (exact.trim().length < 2) return;
      const root = doc!.body;
      const offsets = computeOffsets(root, range);
      if (!offsets) return;
      const full = root.textContent ?? '';
      const rect = range.getBoundingClientRect();
      const frameRect = frameRef.current!.getBoundingClientRect();
      setDraft({
        anchor: {
          block_path: [],
          text_quote: {
            exact,
            prefix: full.slice(Math.max(0, offsets.start - 32), offsets.start),
            suffix: full.slice(offsets.end, offsets.end + 32),
          },
          text_position: offsets,
        },
        rect: new DOMRect(frameRect.left + rect.left, frameRect.top + rect.bottom, rect.width, rect.height),
      });
      setComment('');
    }
    doc.addEventListener('mouseup', handler);
    return () => doc.removeEventListener('mouseup', handler);
  }, [isDeck, loaded, deckDoc]);

  async function save() {
    if (!draft) return;
    const anchor: Anchor =
      draft.anchor ?? {
        block_path: draft.pin ? [draft.pin.slide] : [],
        text_quote: { exact: '', prefix: '', suffix: '' },
        text_position: { start: 0, end: 0 },
      };
    try {
      const res = await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          page_path: pagePath,
          render_path: pagePath,
          kind: 'comment',
          comment_md: comment,
          anchor,
          pin: draft.pin,
        }),
      });
      if (!res.ok) throw new Error('save failed');
      setDraft(null);
      setComment('');
      setPinMode(false);
      deckDoc()?.getSelection?.()?.removeAllRanges();
      flash('Comment saved');
      refresh();
    } catch (err) {
      flash(`Save failed: ${(err as Error).message}`);
    }
  }

  const present = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }, []);

  // Export to PDF via the browser's print dialog. For a deck we print the iframe
  // document directly so its own @media print rules (one .slide per page,
  // landscape) drive pagination; the app chrome never enters the print. The
  // doc's print CSS overrides the viewer's html[data-robin-embed] dimming so
  // every slide — not just the active one — lands in the PDF.
  const exportPdf = useCallback(() => {
    const win = frameRef.current?.contentWindow;
    try {
      if (win) {
        win.focus();
        win.print();
        flash('Opening print dialog — choose “Save as PDF”');
      } else {
        flash('Could not open the deck for printing');
      }
    } catch {
      flash('Print blocked — open the raw file and print from there');
    }
  }, [flash]);

  // Pins on the active slide.
  const slidePins = useMemo(
    () => annotations.filter((a) => a.pin && a.pin.slide === current),
    [annotations, current],
  );

  const commentCountBySlide = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of annotations) if (a.pin) m.set(a.pin.slide, (m.get(a.pin.slide) ?? 0) + 1);
    return m;
  }, [annotations]);

  function onStageClick(e: React.MouseEvent) {
    if (!pinMode || !isDeck) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setDraft({ pin: { slide: current, x, y } });
    setComment('');
  }

  const docW = Math.min(stageW || 900, 1100);
  const kindLabel = isDeck ? 'Presentation' : 'Document';
  const KindIcon = isDeck ? Presentation : FileText;

  return (
    <div className="aw-root">
      <header className="aw-bar">
        <div className="aw-bar-left">
          <span className="aw-kind">
            <KindIcon size={13} strokeWidth={1.6} /> {kindLabel}
          </span>
          <span className="aw-title" title={title}>
            {title}
          </span>
          <span className="aw-path">{filePath}</span>
        </div>
        <div className="aw-bar-right">
          {isDeck && (
            <div className="aw-nav">
              <button type="button" onClick={() => go(current - 1)} disabled={current <= 0} title="Previous (←)">
                <ChevronLeft size={16} strokeWidth={1.6} />
              </button>
              <span className="aw-counter">
                {current + 1} / {slideCount}
              </span>
              <button
                type="button"
                onClick={() => go(current + 1)}
                disabled={current >= slideCount - 1}
                title="Next (→)"
              >
                <ChevronRight size={16} strokeWidth={1.6} />
              </button>
            </div>
          )}
          {isDeck ? (
            <button
              type="button"
              className={`aw-btn ${pinMode ? 'is-on' : ''}`}
              onClick={() => {
                setPinMode((v) => !v);
                setDraft(null);
              }}
              title="Drop a comment pin on the slide"
            >
              <MapPin size={14} strokeWidth={1.6} />
              Pin
            </button>
          ) : null}
          <button
            type="button"
            className={`aw-btn ${railOpen ? 'is-on' : ''}`}
            onClick={() => setRailOpen((v) => !v)}
            title="Toggle comments"
          >
            <MessageSquare size={14} strokeWidth={1.6} />
            {annotations.length > 0 ? annotations.length : ''}
          </button>
          {isDeck && (
            <button type="button" className="aw-btn" onClick={present} title="Present (fullscreen)">
              <Maximize2 size={14} strokeWidth={1.6} />
            </button>
          )}
          <button
            type="button"
            className="aw-btn"
            onClick={exportPdf}
            title={isDeck ? 'Export PDF (one slide per page)' : 'Export PDF'}
          >
            <Printer size={14} strokeWidth={1.6} />
            PDF
          </button>
          <Link href={fileUrl} target="_blank" className="aw-btn" title="Open raw file">
            <ExternalLink size={14} strokeWidth={1.6} />
          </Link>
          <a href={fileUrl} download className="aw-btn" title="Download">
            <Download size={14} strokeWidth={1.6} />
          </a>
        </div>
      </header>

      <div className="aw-body">
        {isDeck && (
          <nav className="aw-slides" aria-label="Slides">
            {slideTitles.map((t, i) => (
              <button
                key={i}
                type="button"
                className={`aw-slide-chip ${i === current ? 'is-active' : ''}`}
                onClick={() => go(i)}
              >
                <span className="aw-slide-n">{i + 1}</span>
                <span className="aw-slide-t">{t || 'Untitled'}</span>
                {commentCountBySlide.get(i) ? (
                  <span className="aw-slide-badge">{commentCountBySlide.get(i)}</span>
                ) : null}
              </button>
            ))}
          </nav>
        )}

        <div className={`aw-stagewrap ${isDeck ? 'is-deck' : 'is-doc'}`}>
          <div
            ref={stageRef}
            className={`aw-stage ${pinMode && isDeck ? 'is-pinning' : ''}`}
          >
            <div
              className="aw-deckbox"
              style={
                isDeck
                  ? { width: DECK_W * scale, height: DECK_H * scale }
                  : { width: docW }
              }
            >
              <div
                className="aw-deckscale"
                style={
                  isDeck
                    ? { width: DECK_W, height: DECK_H, transform: `scale(${scale})` }
                    : { width: docW }
                }
              >
                <iframe
                  ref={frameRef}
                  className={`aw-frame ${isDeck ? '' : 'aw-frame-doc'}`}
                  src={fileUrl}
                  title={title}
                  style={
                    isDeck
                      ? { width: DECK_W, height: DECK_H }
                      : { width: docW }
                  }
                />
                {isDeck && (
                  <div
                    className="aw-pinlayer"
                    style={{ pointerEvents: pinMode && !draft ? 'auto' : 'none' }}
                    onClick={onStageClick}
                  >
                    {slidePins.map((a) => (
                      <span
                        key={a.id}
                        className="aw-pin"
                        data-color={a.color ?? DEFAULT_ANNOTATION_COLOR}
                        style={{ left: `${a.pin!.x * 100}%`, top: `${a.pin!.y * 100}%` }}
                        title={a.comment_md}
                      >
                        <MapPin size={16} strokeWidth={2} />
                      </span>
                    ))}
                    {draft?.pin && draft.pin.slide === current && (
                      <span
                        className="aw-pin is-draft"
                        data-color={DEFAULT_ANNOTATION_COLOR}
                        style={{ left: `${draft.pin.x * 100}%`, top: `${draft.pin.y * 100}%` }}
                      >
                        <MapPin size={16} strokeWidth={2} />
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {railOpen && (
          <aside className="aw-rail">
            <div className="aw-rail-head">
              <Highlighter size={13} strokeWidth={1.6} />
              <span>Comments</span>
              <span className="aw-rail-count">{annotations.length}</span>
            </div>
            <div className="aw-rail-list">
              {annotations.length === 0 ? (
                <p className="aw-rail-empty">
                  {isDeck
                    ? 'No comments yet. Click “Pin” then click anywhere on a slide to leave one.'
                    : 'No comments yet. Select text in the document to leave one.'}
                </p>
              ) : (
                annotations
                  .slice()
                  .sort((a, b) => (a.pin?.slide ?? 0) - (b.pin?.slide ?? 0))
                  .map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="aw-comment"
                      data-color={a.color ?? DEFAULT_ANNOTATION_COLOR}
                      onClick={() => {
                        if (a.pin) go(a.pin.slide);
                      }}
                    >
                      <span className="aw-comment-loc">
                        {a.pin ? `Slide ${a.pin.slide + 1}` : a.anchor?.text_quote.exact ? `“${a.anchor.text_quote.exact.slice(0, 40)}”` : 'Note'}
                      </span>
                      <span className="aw-comment-body">{a.comment_md || '(highlight)'}</span>
                    </button>
                  ))
              )}
            </div>
          </aside>
        )}
      </div>

      {pinMode && isDeck && !draft && (
        <div className="aw-hint">Click anywhere on the slide to drop a comment pin · Esc to cancel</div>
      )}

      {draft && (
        <div
          className="aw-editor"
          style={
            draft.rect
              ? { top: Math.min(draft.rect.top + 8, window.innerHeight - 220), left: Math.min(draft.rect.left, window.innerWidth - 340) }
              : { right: railOpen ? 360 : 24, bottom: 80 }
          }
        >
          <div className="aw-editor-head">
            <span>{draft.pin ? `Slide ${draft.pin.slide + 1}` : 'Comment'}</span>
            <button type="button" className="aw-editor-x" onClick={() => setDraft(null)} title="Cancel">
              <X size={13} strokeWidth={1.6} />
            </button>
          </div>
          <textarea
            className="aw-editor-text"
            autoFocus
            value={comment}
            placeholder={draft.pin ? `Comment on slide ${draft.pin.slide + 1}…` : 'Add a comment…'}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
              if (e.key === 'Escape') setDraft(null);
            }}
          />
          <div className="aw-editor-actions">
            <button type="button" className="aw-btn" onClick={() => setDraft(null)}>
              cancel
            </button>
            <button type="button" className="aw-btn aw-btn-primary" onClick={save} disabled={!comment.trim()}>
              save
            </button>
          </div>
        </div>
      )}

      {toast && <div className="robin-toast">{toast}</div>}

      <span className="aw-mtime-sr" suppressHydrationWarning>
        updated {mounted ? new Date(mtime).toLocaleString() : new Date(mtime).toISOString()}
      </span>
    </div>
  );
}
