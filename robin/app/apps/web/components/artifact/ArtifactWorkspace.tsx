"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
  PenLine,
  Undo2,
  Redo2,
  Bold,
  Italic,
} from "lucide-react";
import {
  DEFAULT_ANNOTATION_COLOR,
  type AnnotationAnchor,
  type AnnotationRecord,
  type SlidePin,
} from "@/lib/annotations";
import { useActiveDocumentRegistration } from "@/components/shell/ActiveDocumentProvider";

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

// Splice edited body content back into the ORIGINAL file bytes so a save only
// touches the region between <body …> and the last </body>. Everything outside
// (doctype, prologue, <head>, the body open tag + its attributes) stays
// byte-identical, which keeps the first edit's log diff scoped to what actually
// changed instead of a browser-normalized whole-document rewrite. Returns null
// if the body tags can't be located, so the caller can fall back to full
// documentElement serialization.
function spliceBody(original: string, newInner: string): string | null {
  const openMatch = original.match(/<body\b[^>]*>/i);
  if (!openMatch || openMatch.index === undefined) return null;
  const openEnd = openMatch.index + openMatch[0].length;
  const closeIdx = original.toLowerCase().lastIndexOf("</body>");
  if (closeIdx < 0 || closeIdx < openEnd) return null;
  return original.slice(0, openEnd) + newInner + original.slice(closeIdx);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  // body.innerHTML captured at edit-start; dirty = current differs from this.
  const editBaselineRef = useRef<string>("");
  // The document object present just before a reloadFrame(); the load poll must
  // NOT latch onto it, since location.reload() is async and the old (still
  // readyState==='complete') document lingers for a tick.
  const staleDocRef = useRef<Document | null>(null);

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
  const [draft, setDraft] = useState<{ pin?: SlidePin; anchor?: Anchor; rect?: DOMRect } | null>(
    null,
  );
  const [comment, setComment] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  // Gate locale-formatted time to after mount — toLocaleString() differs
  // between the Node server and the browser and would cause a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // In-app editing of non-deck out/ HTML artifacts. Decks route to the dedicated
  // ?edit deck editor instead (see the Edit deck affordance below).
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState(mtime);
  const [summary, setSummary] = useState("");
  const [fmt, setFmt] = useState({ bold: false, italic: false });
  const editable = filePath.endsWith(".html") && filePath.startsWith("out/");

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/annotations?page_path=${encodeURIComponent(pagePath)}`, {
        cache: "no-store",
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
    doc.documentElement.setAttribute("data-robin-embed", "");
    // Decks that ship their own complete theme opt out with
    // <meta name="robin:deck-theme" content="self">. Without that escape hatch
    // this injection lands AFTER the deck's own <style>, so robin-deck.css wins
    // every :root token and equal-specificity rule — a self-themed deck loses its
    // background, ink colour, font stack and padding while still looking
    // superficially plausible. The unconditional inject stays the default so
    // legacy decks that link no stylesheet keep working.
    const selfThemed = doc.querySelector(
      'meta[name="robin:deck-theme"][content="self"]',
    );
    if (!selfThemed && !doc.querySelector('link[href="/robin-deck.css"]')) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = "/robin-deck.css";
      doc.head.appendChild(link);
    }
    setIsDeck(true);
    setSlideCount(slides.length);
    setSlideTitles(
      slides.map((s) => {
        const h = s.querySelector("h1, h2");
        const eb = s.querySelector(".eyebrow");
        return ((h?.textContent || eb?.textContent || "") as string).trim();
      }),
    );
    const win = frameRef.current?.contentWindow as
      | (Window & { robinDeck?: { index: number } })
      | null;
    setCurrent(win?.robinDeck?.index ?? 0);
    doc.addEventListener("robin-deck:change", ((e: CustomEvent) => {
      setCurrent(e.detail.index);
    }) as EventListener);
  }, []);

  useEffect(() => {
    fit();
    window.addEventListener("resize", fit);
    const onFs = () => setTimeout(fit, 0);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("resize", fit);
      document.removeEventListener("fullscreenchange", onFs);
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
      // Reload in flight: keep polling until a genuinely different document
      // object appears (or the iframe's 'load' clears the guard). Prevents
      // latching onto the still-complete previous document.
      if (doc && doc === staleDocRef.current) {
        if (tries < 60) {
          tries += 1;
          setTimeout(tick, 100);
        }
        return;
      }
      const ready = doc && doc.readyState === "complete";
      const slides = doc ? Array.from(doc.querySelectorAll(".slide")) : [];
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
      // Clamp here so every caller (buttons AND the keyboard handler, which has
      // no bounds check of its own) stays in range and aligned with the deck.
      // The deck's robinDeck.show() clamps the actual slide, but the unclamped
      // setCurrent ran last and won, leaving React state out of range (counter
      // showing "0 / N" or "N+1 / N", pin layer empty) until the next valid press.
      const n = Math.max(0, Math.min(slideCount - 1, i));
      const win = frameRef.current?.contentWindow as
        | (Window & { robinDeck?: { show: (n: number) => void } })
        | null;
      win?.robinDeck?.show(n);
      setCurrent(n);
    },
    [slideCount],
  );

  // Keyboard nav for decks.
  useEffect(() => {
    if (!isDeck) return;
    function onKey(e: KeyboardEvent) {
      if (draft) return;
      if (e.key === "ArrowRight") go(current + 1);
      else if (e.key === "ArrowLeft") go(current - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDeck, current, go, draft]);

  useEffect(() => {
    if (!pinMode && !draft) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setDraft(null);
      setPinMode(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinMode, draft]);

  // Reload the iframe from its canonical server bytes and re-run load detection.
  // Used after a save (show what was written) and on cancel (drop unsaved DOM).
  const reloadFrame = useCallback(() => {
    // Remember the current document so the load poll won't re-latch onto it
    // while the async reload is still in flight.
    staleDocRef.current = deckDoc();
    setLoaded(false);
    try {
      frameRef.current?.contentWindow?.location.reload();
    } catch {
      if (frameRef.current) frameRef.current.src = fileUrl;
    }
  }, [fileUrl, deckDoc]);

  const startEdit = useCallback(() => {
    const doc = deckDoc();
    if (!doc || !doc.body) {
      flash("Editor not ready yet — try again in a moment");
      return;
    }
    setDirty(false);
    setSaveError(null);
    setSummary("");
    setEditing(true);
  }, [deckDoc, flash]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDirty(false);
    setSaveError(null);
    setSummary("");
    reloadFrame(); // discard unsaved in-DOM edits
  }, [reloadFrame]);

  const saveEdit = useCallback(async (): Promise<boolean> => {
    const doc = deckDoc();
    if (!doc || !doc.body) {
      flash("Editor not ready");
      return false;
    }
    setSaving(true);
    setSaveError(null);
    // Strip the editing attribute before capturing so it never lands in the
    // saved file; head/meta/robin:* are untouched (we only mutated body content).
    try {
      doc.body.removeAttribute("contenteditable");
    } catch {
      /* ignore */
    }
    // Splice the edited body content back into the ORIGINAL file bytes rather
    // than re-serializing documentElement (which drops prologue/doctype
    // variations and rewrites head/body with browser normalization, turning the
    // first edit into a whole-file diff). Everything outside <body> stays
    // byte-identical. Saving without the original hash would make a transient
    // re-fetch failure capable of overwriting a newer external edit, so abort
    // instead of falling back to an unconditional full-document write.
    const bodyInner = doc.body.innerHTML;
    let html: string;
    let expectedHash: string;
    try {
      const orig = await fetch(fileUrl, { cache: "no-store" });
      if (!orig.ok) throw new Error(`could not reload source (${orig.status})`);
      const original = await orig.text();
      expectedHash = await sha256Hex(original);
      const spliced = spliceBody(original, bodyInner);
      if (!spliced) throw new Error("could not safely locate the original body");
      html = spliced;
    } catch (error) {
      try {
        doc.body.setAttribute("contenteditable", "true");
      } catch {
        /* ignore */
      }
      flash(`Save paused: ${(error as Error).message}. Reload and merge before saving.`);
      setSaveError((error as Error).message);
      setSaving(false);
      return false;
    }
    try {
      const res = await fetch("/api/artifact/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          html,
          expected_hash: expectedHash,
          ...(summary.trim() ? { summary: summary.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `save failed (${res.status})`);
      setEditing(false);
      setDirty(false);
      setSummary("");
      setSaveError(null);
      setLastSavedAt(new Date().toISOString());
      flash("Saved");
      reloadFrame();
      return true;
    } catch (err) {
      // Keep the user in edit mode with their work intact.
      try {
        doc.body.setAttribute("contenteditable", "true");
      } catch {
        /* ignore */
      }
      const message = (err as Error).message;
      setSaveError(message);
      flash(`Save failed: ${message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [deckDoc, filePath, fileUrl, summary, flash, reloadFrame]);

  useActiveDocumentRegistration({
    path: filePath,
    mode: editing ? "edit" : "view",
    writeState: saving
      ? { kind: "saving" }
      : saveError
        ? { kind: "error", message: saveError }
        : dirty
          ? { kind: "dirty" }
          : { kind: "saved", at: lastSavedAt },
    updatedAt: lastSavedAt,
    save: editable && (dirty || saveError !== null) ? saveEdit : undefined,
    discard: editing ? cancelEdit : undefined,
  });

  // Reflect Bold/Italic active state for the current selection in the iframe doc.
  const refreshFmtState = useCallback(() => {
    const doc = deckDoc();
    if (!doc) return;
    try {
      setFmt({ bold: doc.queryCommandState("bold"), italic: doc.queryCommandState("italic") });
    } catch {
      /* queryCommandState unsupported/unavailable — leave as-is */
    }
  }, [deckDoc]);

  // Drive a formatting/undo command on the (same-origin) iframe document.
  // execCommand is deprecated but is the only universally supported way to hook
  // the browser's native contentEditable undo/redo + inline formatting, which
  // already batch typing at a sane granularity. Toolbar buttons preventDefault
  // on mousedown (below) so the iframe keeps focus + selection when clicked.
  // Dirty tracks a REAL change against the edit-start baseline, so undoing back
  // to pristine clears "Unsaved changes". Cheap enough to compare directly.
  const recomputeDirty = useCallback(() => {
    const doc = deckDoc();
    if (!doc || !doc.body) return;
    setDirty(doc.body.innerHTML !== editBaselineRef.current);
  }, [deckDoc]);

  const runCmd = useCallback(
    (cmd: "undo" | "redo" | "bold" | "italic") => {
      const doc = deckDoc();
      if (!doc) return;
      try {
        doc.execCommand(cmd, false);
        recomputeDirty();
        refreshFmtState();
      } catch {
        /* ignore */
      }
    },
    [deckDoc, recomputeDirty, refreshFmtState],
  );

  // Cancel that protects unsaved work. Used by the button, Escape, and the
  // beforeunload guard's sibling paths.
  const guardedCancel = useCallback(() => {
    if (dirty && !window.confirm("Discard unsaved changes to this artifact?")) return;
    cancelEdit();
  }, [dirty, cancelEdit]);

  // Keyboard while editing — attached to BOTH the parent window and the iframe's
  // contentDocument so shortcuts fire whether focus is in the app chrome or
  // inside the editable body.
  useEffect(() => {
    if (!editing) return undefined;
    const doc = deckDoc();
    const onKey = (e: KeyboardEvent) => {
      // The summary field (and any input/textarea in the app chrome, i.e. not
      // the iframe body) must keep native text editing: no Z/Y/B/I hijacking,
      // and Escape blurs the field instead of cancelling the whole edit.
      const t = e.target as HTMLElement | null;
      const inField =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && t.ownerDocument === document;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (inField) {
            t!.blur();
            return;
          }
          guardedCancel();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "s" || k === "enter") {
        // Save works from anywhere, including the summary field. preventDefault
        // so the browser's own Save dialog (Cmd/Ctrl+S) never opens.
        e.preventDefault();
        if (!saving) saveEdit();
        return;
      }
      // Let native input undo/redo/bold/italic work inside the summary field.
      if (inField) return;
      if (k === "z") {
        e.preventDefault();
        runCmd(e.shiftKey ? "redo" : "undo");
      } else if (k === "y") {
        e.preventDefault();
        runCmd("redo");
      } else if (k === "b") {
        e.preventDefault();
        runCmd("bold");
      } else if (k === "i") {
        e.preventDefault();
        runCmd("italic");
      }
    };
    window.addEventListener("keydown", onKey);
    doc?.addEventListener("keydown", onKey as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      doc?.removeEventListener("keydown", onKey as EventListener);
    };
  }, [editing, deckDoc, runCmd, guardedCancel, saveEdit, saving]);

  // Keep Bold/Italic button state in sync with the caret/selection while editing.
  useEffect(() => {
    if (!editing) return undefined;
    const doc = deckDoc();
    if (!doc) return undefined;
    const on = () => refreshFmtState();
    doc.addEventListener("selectionchange", on);
    doc.addEventListener("input", on);
    on();
    return () => {
      doc.removeEventListener("selectionchange", on);
      doc.removeEventListener("input", on);
    };
  }, [editing, deckDoc, refreshFmtState]);

  // Toggle contentEditable on the (same-origin) artifact body while editing, and
  // track dirty state. Cleanup always removes the attribute.
  useEffect(() => {
    if (!editing) return undefined;
    const doc = deckDoc();
    if (!doc || !doc.body) return undefined;
    // Baseline for dirty detection — everything after this is "a change".
    editBaselineRef.current = doc.body.innerHTML;
    doc.body.setAttribute("contenteditable", "true");
    try {
      doc.body.focus();
    } catch {
      /* ignore */
    }
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onInput = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(recomputeDirty, 300);
    };
    doc.addEventListener("input", onInput);
    return () => {
      if (debounce) clearTimeout(debounce);
      doc.removeEventListener("input", onInput);
      try {
        doc.body.removeAttribute("contenteditable");
      } catch {
        /* ignore */
      }
    };
  }, [editing, deckDoc, recomputeDirty]);

  // Text selection → comment, for document artifacts. Suspended while editing so
  // caret selections in the editable body don't spawn comment drafts.
  useEffect(() => {
    if (isDeck || !loaded || editing) return;
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
      const full = root.textContent ?? "";
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
        rect: new DOMRect(
          frameRect.left + rect.left,
          frameRect.top + rect.bottom,
          rect.width,
          rect.height,
        ),
      });
      setComment("");
    }
    doc.addEventListener("mouseup", handler);
    return () => doc.removeEventListener("mouseup", handler);
  }, [isDeck, loaded, deckDoc, editing]);

  async function save() {
    if (!draft) return;
    const anchor: Anchor = draft.anchor ?? {
      block_path: draft.pin ? [draft.pin.slide] : [],
      text_quote: { exact: "", prefix: "", suffix: "" },
      text_position: { start: 0, end: 0 },
    };
    try {
      const res = await fetch("/api/annotations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          page_path: pagePath,
          render_path: pagePath,
          kind: "comment",
          comment_md: comment,
          anchor,
          pin: draft.pin,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      setDraft(null);
      setComment("");
      setPinMode(false);
      deckDoc()?.getSelection?.()?.removeAllRanges();
      flash("Comment saved");
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
        flash("Opening print dialog — choose “Save as PDF”");
      } else {
        flash("Could not open the deck for printing");
      }
    } catch {
      flash("Print blocked — open the raw file and print from there");
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
    setComment("");
  }

  const docW = Math.min(stageW || 900, 1100);
  const kindLabel = isDeck ? "Presentation" : "Document";
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
          {editing ? (
            <>
              <span className="aw-kind" style={{ color: dirty ? "var(--blue)" : "var(--muted)" }}>
                {dirty ? "Unsaved changes" : "Editing"}
              </span>
              <button
                type="button"
                className="aw-btn aw-btn-icon"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCmd("undo")}
                disabled={saving}
                title="Undo (⌘/Ctrl+Z)"
                aria-label="Undo"
              >
                <Undo2 size={14} strokeWidth={1.6} />
              </button>
              <button
                type="button"
                className="aw-btn aw-btn-icon"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCmd("redo")}
                disabled={saving}
                title="Redo (⇧⌘/Ctrl+Z or Ctrl+Y)"
                aria-label="Redo"
              >
                <Redo2 size={14} strokeWidth={1.6} />
              </button>
              <button
                type="button"
                className={`aw-btn aw-btn-icon ${fmt.bold ? "is-on" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCmd("bold")}
                disabled={saving}
                title="Bold (⌘/Ctrl+B)"
                aria-label="Bold"
              >
                <Bold size={14} strokeWidth={1.6} />
              </button>
              <button
                type="button"
                className={`aw-btn aw-btn-icon ${fmt.italic ? "is-on" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCmd("italic")}
                disabled={saving}
                title="Italic (⌘/Ctrl+I)"
                aria-label="Italic"
              >
                <Italic size={14} strokeWidth={1.6} />
              </button>
              <input
                value={summary}
                placeholder="What changed? (optional)"
                aria-label="Summary of what changed"
                style={{
                  height: 30,
                  width: 210,
                  padding: "0 10px",
                  border: "1px solid var(--line-strong)",
                  borderRadius: 8,
                  background: "var(--card)",
                  color: "var(--ink)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 12,
                }}
                onChange={(e) => setSummary(e.target.value)}
              />
              <button
                type="button"
                className="aw-btn"
                onClick={guardedCancel}
                disabled={saving}
                title="Cancel (Esc)"
              >
                Cancel
              </button>
              <button
                type="button"
                className="aw-btn aw-btn-primary"
                onClick={saveEdit}
                disabled={saving}
                title="Save changes (⌘/Ctrl+S or ⌘/Ctrl+Enter)"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <>
              {isDeck && (
                <div className="aw-nav">
                  <button
                    type="button"
                    onClick={() => go(current - 1)}
                    disabled={current <= 0}
                    title="Previous (←)"
                  >
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
                  className={`aw-btn ${pinMode ? "is-on" : ""}`}
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
                className={`aw-btn ${railOpen ? "is-on" : ""}`}
                onClick={() => setRailOpen((v) => !v)}
                title="Toggle comments"
              >
                <MessageSquare size={14} strokeWidth={1.6} />
                {annotations.length > 0 ? annotations.length : ""}
              </button>
              {isDeck && (
                <button
                  type="button"
                  className="aw-btn"
                  onClick={present}
                  title="Present (fullscreen)"
                >
                  <Maximize2 size={14} strokeWidth={1.6} />
                </button>
              )}
              <button
                type="button"
                className="aw-btn"
                onClick={exportPdf}
                title={isDeck ? "Export PDF (one slide per page)" : "Export PDF"}
              >
                <Printer size={14} strokeWidth={1.6} />
                PDF
              </button>
              {loaded && editable ? (
                isDeck ? (
                  <button
                    type="button"
                    className="aw-btn"
                    onClick={() => window.open(`${fileUrl}?edit`, "_blank", "noopener")}
                    title="Open the deck editor in a new tab"
                  >
                    <PenLine size={14} strokeWidth={1.6} />
                    Edit deck
                  </button>
                ) : (
                  <button
                    type="button"
                    className="aw-btn"
                    onClick={startEdit}
                    title="Edit this artifact in place"
                  >
                    <PenLine size={14} strokeWidth={1.6} />
                    Edit
                  </button>
                )
              ) : null}
              <Link href={fileUrl} target="_blank" className="aw-btn" title="Open raw file">
                <ExternalLink size={14} strokeWidth={1.6} />
              </Link>
              <a href={fileUrl} download className="aw-btn" title="Download">
                <Download size={14} strokeWidth={1.6} />
              </a>
            </>
          )}
        </div>
      </header>

      <div className="aw-body">
        {isDeck && (
          <nav className="aw-slides" aria-label="Slides">
            {slideTitles.map((t, i) => (
              <button
                key={i}
                type="button"
                className={`aw-slide-chip ${i === current ? "is-active" : ""}`}
                onClick={() => go(i)}
              >
                <span className="aw-slide-n">{i + 1}</span>
                <span className="aw-slide-t">{t || "Untitled"}</span>
                {commentCountBySlide.get(i) ? (
                  <span className="aw-slide-badge">{commentCountBySlide.get(i)}</span>
                ) : null}
              </button>
            ))}
          </nav>
        )}

        <div className={`aw-stagewrap ${isDeck ? "is-deck" : "is-doc"}`}>
          <div ref={stageRef} className={`aw-stage ${pinMode && isDeck ? "is-pinning" : ""}`}>
            <div
              className="aw-deckbox"
              style={isDeck ? { width: DECK_W * scale, height: DECK_H * scale } : { width: docW }}
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
                  className={`aw-frame ${isDeck ? "" : "aw-frame-doc"}`}
                  src={fileUrl}
                  title={title}
                  onLoad={() => {
                    // A genuine load means the new document has arrived; drop
                    // the stale-doc guard so the poll can latch immediately.
                    staleDocRef.current = null;
                  }}
                  style={isDeck ? { width: DECK_W, height: DECK_H } : { width: docW }}
                />
                {isDeck && (
                  <div
                    className="aw-pinlayer"
                    style={{ pointerEvents: pinMode && !draft ? "auto" : "none" }}
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
                    ? "No comments yet. Click “Pin” then click anywhere on a slide to leave one."
                    : "No comments yet. Select text in the document to leave one."}
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
                        {a.pin
                          ? `Slide ${a.pin.slide + 1}`
                          : a.anchor?.text_quote.exact
                            ? `“${a.anchor.text_quote.exact.slice(0, 40)}”`
                            : "Note"}
                      </span>
                      <span className="aw-comment-body">{a.comment_md || "(highlight)"}</span>
                    </button>
                  ))
              )}
            </div>
          </aside>
        )}
      </div>

      <footer className="aw-prov">
        <span>
          source <b>{filePath}</b>
        </span>
        <span>
          {kindLabel}
          {isDeck && slideCount > 0 ? ` · ${slideCount} slides` : ""}
        </span>
        <span suppressHydrationWarning>
          last write{" "}
          <b>{mounted ? new Date(mtime).toLocaleString() : new Date(mtime).toISOString()}</b>
        </span>
        {annotations.length > 0 ? <span>{annotations.length} annotations</span> : null}
      </footer>

      {pinMode && isDeck && !draft && (
        <div className="aw-hint">
          Click anywhere on the slide to drop a comment pin · Esc to cancel
        </div>
      )}

      {draft && (
        <div
          className="aw-editor"
          style={
            draft.rect
              ? {
                  top: Math.min(draft.rect.top + 8, window.innerHeight - 220),
                  left: Math.min(draft.rect.left, window.innerWidth - 340),
                }
              : { right: railOpen ? 360 : 24, bottom: 80 }
          }
        >
          <div className="aw-editor-head">
            <span>{draft.pin ? `Slide ${draft.pin.slide + 1}` : "Comment"}</span>
            <button
              type="button"
              className="aw-editor-x"
              onClick={() => setDraft(null)}
              title="Cancel"
            >
              <X size={13} strokeWidth={1.6} />
            </button>
          </div>
          <textarea
            className="aw-editor-text"
            autoFocus
            value={comment}
            placeholder={draft.pin ? `Comment on slide ${draft.pin.slide + 1}…` : "Add a comment…"}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
              if (e.key === "Escape") setDraft(null);
            }}
          />
          <div className="aw-editor-actions">
            <button type="button" className="aw-btn" onClick={() => setDraft(null)}>
              cancel
            </button>
            <button
              type="button"
              className="aw-btn aw-btn-primary"
              onClick={save}
              disabled={!comment.trim()}
            >
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
