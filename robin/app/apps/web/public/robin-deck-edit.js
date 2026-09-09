/* ============================================================
   robin-deck-edit.js — in-place ?edit mode for Robin decks
   ------------------------------------------------------------
   Ported from the Slides framework (noskillish/slides, MIT) and
   adapted to Robin: navigation runs through window.robinDeck and
   the `robin-deck:change` event; layout shifts the centred .deck
   with a body padding instead of stretching it; slides serialize
   at column 0 to match Robin's deck markup, so <meta name=robin:*>
   in <head> and the deck scripts in the tail pass through
   byte-for-byte and only edited slides rewrite (clean diffs).

   Loaded on demand by robin-deck.js when the deck is opened with
   ?edit AND is NOT inside the Robin viewer (html[data-robin-embed]);
   in-app editing and per-slide comments are the viewer's job.

   Text: click to edit in place (plain text only).
   Slides: reorder / duplicate / delete via the left rail.
   Save:  Cmd/Ctrl+S or the Save button writes back to this file
   in place (Chromium; the first save asks you to pick the file
   once). Other browsers download an updated copy.
   ============================================================ */
(() => {
  if (!new URLSearchParams(location.search).has('edit')) return;
  if (document.documentElement.hasAttribute('data-robin-embed')) return;
  if (!window.robinDeck) return;

  const RAIL_W = 200, THUMB_W = 164;
  const deck = document.querySelector('.deck');
  if (!deck) return;
  const liveSlides = () => [...deck.querySelectorAll(':scope > .slide')];
  const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
  const $ = (id) => document.getElementById(id);

  let baseCount = 0;          // slide count in the on-disk file we mapped against
  let structuralChanged = false;
  let fileHandle = null;
  let justPicked = false;     // true when this save triggered the one-time file pick
  const undoStack = [];
  const redoStack = [];
  let pendingTextUndo = null;   // pre-edit snapshot captured on focusin, committed on first input
  let autoSaveTimer = null;
  let saving = false;
  let editSeq = 0;              // bumped on every edit; lets a save detect edits that landed mid-flight

  function scheduleAutoSave() {
    if (saving) return;
    if (!deriveVaultPath() && !fileHandle) return; // server path or a picked file handle
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => { if (typeof autoSave === 'function') autoSave(); }, 2000);
  }

  /* ---------- server save (logged write path, /api/artifact/save) ----------
     When the deck is served from /api/file/out/<...>.html we can derive its
     vault-relative path and save through the logged endpoint (.history snapshot
     + edits-JSONL event). Otherwise we fall back to the File System Access flow
     below. The external-edit guard is the same: re-fetch the on-disk source
     (no-store) and splice against it; a slide-count mismatch aborts the merge. */
  function deriveVaultPath() {
    const prefix = '/api/file/';
    if (!location.pathname.startsWith(prefix)) return null;
    let rel;
    try { rel = decodeURIComponent(location.pathname.slice(prefix.length)); }
    catch (e) { return null; }
    if (!rel.startsWith('out/') || !rel.endsWith('.html')) return null;
    return rel;
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function reanchor() {
    liveSlides().forEach((s, i) => { delete s.dataset.edDirty; s.dataset.srcIdx = i; });
    baseCount = liveSlides().length;
    structuralChanged = false;
    markDirty(); renderRail();
  }

  async function serverSave(interactive) {
    const vaultRel = deriveVaultPath();
    if (!vaultRel) return false;
    if (!hasChanges()) return true;
    saving = true;
    status('Saving...');
    try {
      const resp = await fetch(location.pathname, { cache: 'no-store' });
      if (!resp.ok) {
        // F7: distinguish a failed re-fetch from a genuine external change.
        saving = false;
        const msg = 'reload failed (HTTP ' + resp.status + ')';
        if (interactive) offerServerFallback(msg);
        else { status(msg); setTimeout(() => status('Edit mode'), 4000); }
        return false;
      }
      const src = await resp.text();
      const expectedHash = await sha256Hex(src);
      const seqAtSave = editSeq;   // F2: snapshot the edit counter as we serialize
      const out = splice(src);
      if (out == null) {
        saving = false;
        if (interactive) offerServerFallback('The file on disk changed since load — in-place merge is unsafe.');
        else { status('Auto-save skipped (file changed externally)'); setTimeout(() => status('Edit mode'), 3000); }
        return false;
      }
      const r = await fetch('/api/artifact/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: vaultRel,
          html: out,
          expected_hash: expectedHash,
          summary: 'Deck edit (in-place)',
          actor: 'deck-editor'
        }),
      });
      if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
      }
      saving = false;
      // F2: only clear dirty state if nothing was edited while the POST was in flight;
      // otherwise the newer edits are NOT in `out`, so keep them and save again.
      if (editSeq === seqAtSave) {
        reanchor();
        status('Saved');
        setTimeout(() => status('Edit mode'), 1500);
      } else {
        status('Saved — writing newer edits…');
        setTimeout(() => status('Edit mode'), 1500);
        scheduleAutoSave();
      }
      return true;
    } catch (err) {
      console.error('Server save failed:', err);
      saving = false;
      if (interactive) offerServerFallback('Server save failed: ' + (err && err.message) + '.');
      else { status('Auto-save failed — press Cmd/Ctrl+S to retry'); setTimeout(() => status('Edit mode'), 4000); }
      return false;
    }
  }

  // error/guard chrome: keep both the download escape hatch and the FSA fallback
  function offerServerFallback(msg) {
    const canFsa = !!window.showOpenFilePicker;
    bar.innerHTML = '<span class="ed-status" id="edStatus">' + msg + '</span>' +
      (canFsa ? '<button id="edFsa">Save to file…</button>' : '') +
      '<button class="ed-save" id="edDl">Download copy</button>' +
      '<button id="edBack">Back</button>';
    if (canFsa) $('edFsa').addEventListener('click', () => { restoreToolbar(); fsaSave(); });
    $('edDl').addEventListener('click', () => { downloadCopy(); setTimeout(restoreToolbar, 1200); });
    $('edBack').addEventListener('click', restoreToolbar);
  }

  /* ---------- editor styles (theme-adaptive via --ed-* tokens) ---------- */
  const css = document.createElement('style');
  css.dataset.edUi = '';
  css.textContent = `
    body.ed-on { --ed-panel: rgba(255,255,255,.93); --ed-ink: #1a1a1a; --ed-inv: #ffffff;
      --ed-line: rgba(0,0,0,.14); --ed-dim: rgba(0,0,0,.45); --ed-view-bg: #ffffff; }
    body.ed-on.ed-dark { --ed-panel: rgba(28,28,32,.93); --ed-ink: #f5f5f3; --ed-inv: #1a1a1a;
      --ed-line: rgba(255,255,255,.18); --ed-dim: rgba(255,255,255,.5); --ed-view-bg: #131316; }
    body.ed-on { padding-left: ${RAIL_W}px; }
    body.ed-on .edit-btn { display: none; }
    [contenteditable] { outline: none; cursor: text; border-radius: 3px; }
    [contenteditable]:hover { box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 35%, transparent); }
    [contenteditable]:focus { box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 60%, transparent); }
    [contenteditable]:empty::before { content: '\\2026'; opacity: .35; }
    .ed-toolbar { position: fixed; top: 14px; right: 16px; z-index: 1000; display: flex; gap: 8px;
      align-items: center; font-family: inherit; font-size: 12px; font-weight: 500; line-height: 1.3;
      background: var(--ed-panel); color: var(--ed-ink); backdrop-filter: blur(8px);
      border: 1px solid var(--ed-line); border-radius: 10px; padding: 8px 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,.12); }
    .ed-toolbar button { font-family: inherit; font-size: 12px; font-weight: 500;
      border: 1px solid var(--ed-line); background: transparent; color: var(--ed-ink);
      border-radius: 6px; padding: 6px 12px; cursor: pointer; }
    .ed-toolbar button:hover:not(:disabled) { border-color: var(--ed-ink); }
    .ed-toolbar .ed-icon { padding: 6px 9px; font-size: 15px; line-height: 1; min-width: 30px; }
    .ed-toolbar button:disabled { opacity: .4; cursor: default; }
    .ed-toolbar .ed-save.ed-dirty { background: var(--ed-ink); border-color: var(--ed-ink); color: var(--ed-inv); }
    .ed-status { color: var(--ed-dim); max-width: 240px; }
    .ed-rail { position: fixed; left: 0; top: 0; bottom: 0; width: ${RAIL_W}px; z-index: 999;
      overflow-y: auto; background: var(--ed-panel); backdrop-filter: blur(8px);
      border-right: 1px solid var(--ed-line); padding: 14px 12px 80px;
      display: flex; flex-direction: column; align-items: center; }
    .ed-thumb { position: relative; width: fit-content; margin-bottom: 12px; border: 2px solid transparent; border-radius: 10px;
      cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; transition: border-color 0.15s ease; }
    .ed-thumb.ed-current { border-color: var(--ed-ink); }
    .ed-thumb.ed-drop-before { box-shadow: 0 -3px 0 0 var(--ed-ink); }
    .ed-thumb.ed-dragging { opacity: .65; z-index: 10; }
    .ed-thumb-view { position: relative; width: ${THUMB_W}px; overflow: hidden; border-radius: 8px;
      border: 1px solid var(--ed-line); pointer-events: none; background: var(--ed-view-bg); }
    .ed-n { position: absolute; top: 6px; left: 6px; z-index: 2; font-family: inherit; font-size: 9px;
      font-weight: 500; color: var(--ed-ink); background: var(--ed-panel); border: 1px solid var(--ed-line);
      border-radius: 5px; padding: 1px 5px; line-height: 1.4; pointer-events: none; }
    .ed-thumb-bar { position: absolute; right: 6px; bottom: 6px; display: flex; align-items: center; gap: 1px;
      padding: 3px; border-radius: 9px; background: var(--ed-panel); border: 1px solid var(--ed-line);
      box-shadow: 0 2px 8px rgba(0,0,0,.18); backdrop-filter: blur(6px);
      opacity: 0; pointer-events: none; transition: opacity 0.12s ease; }
    .ed-thumb:hover .ed-thumb-bar { opacity: 1; pointer-events: auto; }
    .ed-thumb-bar button { border: none; background: none; cursor: pointer; font-size: 11px;
      color: var(--ed-dim); padding: 3px 5px; border-radius: 6px; line-height: 1; }
    .ed-thumb-bar button:hover { color: var(--ed-ink);
      background: color-mix(in srgb, var(--ed-ink) 8%, transparent); }
    body.ed-on .slide img, body.ed-on .slide video { transition: outline-color 0.12s ease; }
    body.ed-on .slide img:hover, body.ed-on .slide video:hover { outline: 2px solid color-mix(in srgb, var(--ed-ink) 55%, transparent); outline-offset: -2px; }
    .ed-img-drag { outline: 2px dashed var(--ed-ink) !important; outline-offset: -2px; }
    .ed-imgbar { position: fixed; z-index: 1001; display: none; flex-direction: column; align-items: center; gap: 8px;
      transform: translate(-50%, -50%); padding: 14px; border-radius: 12px; text-align: center;
      background: var(--ed-panel); border: 1px solid var(--ed-line);
      box-shadow: 0 6px 22px rgba(0,0,0,.22); backdrop-filter: blur(8px); font-family: inherit; }
    .ed-imgbar-label { font-size: 9px; font-weight: 500; letter-spacing: .1em; text-transform: uppercase; color: var(--ed-dim); }
    .ed-imgbar-main { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .ed-imgbar-drop { display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer;
      width: 210px; max-width: 60vw; padding: 16px 18px; border: 1.5px dashed var(--ed-line); border-radius: 10px;
      background: transparent; color: var(--ed-dim); font-family: inherit; transition: border-color .12s ease, color .12s ease; }
    .ed-imgbar-drop:hover, .ed-imgbar.ed-drag-active .ed-imgbar-drop { border-color: var(--ed-ink); color: var(--ed-ink); }
    .ed-imgbar-drop svg { width: 24px; height: 24px; stroke: currentColor; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    .ed-imgbar-drop-title { font-size: 12px; font-weight: 500; color: var(--ed-ink); }
    .ed-imgbar-drop-sub { font-size: 10px; }
    .ed-imgbar-linkbtn { font-family: inherit; font-size: 11px; font-weight: 500; cursor: pointer; border: none;
      background: none; color: var(--ed-dim); padding: 2px; text-decoration: underline; text-underline-offset: 2px; }
    .ed-imgbar-linkbtn:hover { color: var(--ed-ink); }
    .ed-imgbar-link { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .ed-imgbar-input { font-family: inherit; font-size: 12px; color: var(--ed-ink); width: 220px; max-width: 50vw;
      padding: 7px 10px; border-radius: 7px; border: 1px solid var(--ed-line); background: var(--ed-view-bg); outline: none; }
    .ed-imgbar-input:focus { border-color: var(--ed-ink); }
    @media print { .ed-rail, .ed-toolbar, [data-ed-ui] { display: none !important; }
      body.ed-on { padding-left: 0; } }
  `;
  document.head.appendChild(css);
  document.body.classList.add('ed-on');

  /* match the editor chrome to the theme */
  (function detectDark() {
    for (const probe of [document.body, document.querySelector('.slide')]) {
      if (!probe) continue;
      const m = getComputedStyle(probe).backgroundColor.match(/[\d.]+/g);
      if (!m || m.length < 3 || (m.length > 3 && +m[3] === 0)) continue;
      if (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2] < 128) document.body.classList.add('ed-dark');
      return;
    }
  })();

  /* ---------- inline text editing (leaf-level, plaintext only) ---------- */
  const INLINE = new Set(['SPAN', 'SUP', 'SUB', 'STRONG', 'EM', 'B', 'I', 'A', 'BR']);

  function isTextLeaf(node) {
    if (!node.childNodes.length) return false;
    for (const n of node.childNodes) {
      if (n.nodeType === 3) continue;
      if (n.nodeType !== 1 || !INLINE.has(n.tagName)) return false;
      if (n.tagName !== 'BR' && n.childNodes.length && !isTextLeaf(n)) return false;
    }
    return node.textContent.trim().length > 0;
  }

  function setEd(n) {
    n.setAttribute('contenteditable', 'plaintext-only');
    n.setAttribute('spellcheck', 'false');
  }

  function makeEditable(root) {
    const leaves = [];
    (function walk(node) {
      for (const c of node.children) (isTextLeaf(c) ? leaves.push(c) : walk(c));
    })(root);
    for (const leaf of leaves) {
      const hasEls = [...leaf.children].some((c) => c.tagName !== 'BR');
      if (!hasEls) { setEd(leaf); continue; }
      // mixed content: protected inline spans + bare text runs each become their own field
      for (const c of leaf.children) {
        if (c.tagName !== 'BR' && c.textContent.length) setEd(c);
      }
      for (const n of [...leaf.childNodes]) {
        if (n.nodeType === 3 && n.textContent.trim()) {
          const w = document.createElement('span');
          w.dataset.edWrap = '';
          n.replaceWith(w); w.appendChild(n); setEd(w);
        }
      }
    }
  }

  /* ---------- dirty tracking ---------- */
  const hasChanges = () => structuralChanged || !!deck.querySelector('[data-ed-dirty]');
  function markDirty() {
    editSeq++;                    // F2: any dirty-marking edit advances the counter
    const btn = $('edSave');
    if (btn) btn.classList.toggle('ed-dirty', hasChanges());
    if (hasChanges()) scheduleAutoSave();
  }

  function watchMutations() {
    new MutationObserver((muts) => {
      let hit = false;
      for (const m of muts) {
        const elx = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        const slide = elx && elx.closest('.slide');
        if (slide && deck.contains(slide)) { slide.dataset.edDirty = '1'; hit = true; }
      }
      if (hit) { editSeq++; markDirty(); }   // F2: DOM mutation advances the counter
      // free-position drag/resize mutate inline styles; keep the splice save honest
    }).observe(deck, { childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ['style'] });
  }

  /* ---------- navigation: driven through window.robinDeck ----------
     robinDeck.refresh() re-scans slides after a structural edit; robinDeck.show()
     renders and fires `robin-deck:change`, which we use to keep the rail in sync
     no matter whether the change came from a key, the rail, or a drag. */
  const curIdx = () => liveSlides().findIndex((s) => s.classList.contains('active'));
  function edShow(i) {
    window.robinDeck.refresh();
    window.robinDeck.show(Math.max(0, Math.min(i, liveSlides().length - 1)));
  }
  document.addEventListener('robin-deck:change', () => { highlightThumb(); hideImgBar(); hideSel(); });

  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); doSave(); return; }
    if (e.target.isContentEditable) {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape') e.target.blur();
      e.stopPropagation();          // keep deck navigation away from typing
      return;
    }
    const key = e.key.toLowerCase();
    if (meta && key === 'z' && !e.shiftKey && undoStack.length) {
      e.preventDefault(); e.stopPropagation(); popUndo(); return;
    }
    if (meta && ((key === 'z' && e.shiftKey) || key === 'y') && redoStack.length) {
      e.preventDefault(); e.stopPropagation(); popRedo(); return;
    }
    // selection keys (only when a free-position block is selected and not typing)
    if (selected && !meta) {
      if (e.key === 'Escape') { e.stopPropagation(); hideSel(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation(); deleteSelected(); return;
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault(); e.stopPropagation(); nudge(e.key, e.shiftKey ? 10 : 1); return;
      }
    }
  }, true);

  /* ---------- undo / redo (full-deck innerHTML snapshots) ----------
     Snapshots capture deck.innerHTML (inline styles, contenteditable attrs, and
     per-slide data-ed-dirty / data-src-idx markers all included), so a restore is
     exact — including free-position geometry after a drag/resize — and the splice
     save still sees the right dirty slides. A brand-new edit (any pushUndo call)
     clears the redo stack; undo/redo shuttle a snapshot between the two stacks. */
  function snapshot() { return { type: 'deck', html: deck.innerHTML, cur: curIdx() }; }
  // F3: text edits snapshot just the focused slide (cheap) instead of the whole deck.
  // The undo/redo stacks hold a mix of 'deck' and 'slide' snapshots; restoreSnapshot
  // dispatches on the type, so structural ops stay full-deck and text edits stay local.
  function slideSnapshot(slide) {
    return { type: 'slide', idx: liveSlides().indexOf(slide), html: slide.outerHTML, cur: curIdx() };
  }
  function restoreSnapshot(s) {
    hideSel();
    if (s.type === 'slide') {
      const target = liveSlides()[s.idx];
      if (target) {
        const tmp = document.createElement('template');
        tmp.innerHTML = s.html;
        const fresh = tmp.content.firstElementChild;
        // fresh keeps its data-src-idx + contenteditable attrs, so the splice fast
        // path still maps it; mark just this slide dirty (no structural re-serialize).
        if (fresh) { target.replaceWith(fresh); fresh.dataset.edDirty = '1'; }
      }
      renderRail(); edShow(s.cur); markDirty(); updateUndoButtons();
      return;
    }
    deck.innerHTML = s.html;
    structuralChanged = true;   // force the splice save down the re-serialize path
    renderRail(); edShow(s.cur); markDirty(); updateUndoButtons();
  }
  function updateUndoButtons() {
    const u = $('edUndo'), r = $('edRedo');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;       // a new edit invalidates the redo history
    pendingTextUndo = null;     // and supersedes any un-committed text snapshot
    updateUndoButtons();
  }
  function popUndo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restoreSnapshot(undoStack.pop());
  }
  function popRedo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restoreSnapshot(redoStack.pop());
  }

  /* Text edits: snapshot on focusin (before the field is touched) and commit that
     snapshot to the undo stack on the first input, so a whole field edit is one
     undo step. Native contentEditable undo still handles keystroke-level undo
     while the field stays focused. */
  deck.addEventListener('focusin', (e) => {
    if (!e.target.isContentEditable) return;
    const slide = e.target.closest('.slide');
    pendingTextUndo = slide ? slideSnapshot(slide) : snapshot();
  });
  deck.addEventListener('input', (e) => {
    if (e.target.isContentEditable && pendingTextUndo) {
      undoStack.push(pendingTextUndo);
      if (undoStack.length > 50) undoStack.shift();
      redoStack.length = 0;
      pendingTextUndo = null;
      updateUndoButtons();
    }
    // F6: a text edit changes the block's geometry — keep the selection overlay glued.
    if (selected) positionSel();
  });

  /* ---------- thumbnail rail ---------- */
  const rail = el('div', 'ed-rail'); rail.dataset.edUi = '';
  document.body.appendChild(rail);

  function makeThumb(slide, i) {
    const t = el('div', 'ed-thumb'); t.dataset.idx = i;
    const view = el('div', 'ed-thumb-view');
    const dw = deck.clientWidth || innerWidth, dh = deck.clientHeight || innerHeight;
    const sc = THUMB_W / dw;
    view.style.height = (dh * sc) + 'px';
    const c = slide.cloneNode(true);
    c.classList.remove('active');
    c.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    c.style.cssText = 'display:block; position:absolute; inset:auto; left:0; top:0; width:' + dw +
      'px; height:' + dh + 'px; transform:scale(' + sc + '); transform-origin:0 0;';
    view.appendChild(c);
    const num = el('div', 'ed-n'); num.textContent = (i + 1);
    view.appendChild(num);
    const bar = el('div', 'ed-thumb-bar');
    bar.innerHTML = '<button data-act="up" title="Move up">&#8593;</button>' +
      '<button data-act="down" title="Move down">&#8595;</button>' +
      '<button data-act="dup" title="Duplicate">&#10697;</button>' +
      '<button data-act="del" title="Delete">&#10005;</button>';
    t.append(view, bar);
    return t;
  }

  function renderRail() {
    rail.textContent = '';
    liveSlides().forEach((s, i) => rail.appendChild(makeThumb(s, i)));
    highlightThumb();
  }

  function highlightThumb() {
    const cur = curIdx();
    const thumbs = rail.querySelectorAll('.ed-thumb');
    thumbs.forEach((t, j) => t.classList.toggle('ed-current', j === cur));
    if (thumbs[cur]) thumbs[cur].scrollIntoView({ block: 'nearest' });
  }

  function structural() { hideSel(); structuralChanged = true; renderRail(); markDirty(); }

  // shared: re-render one slide's rail thumbnail after an in-place edit
  function refreshThumbSlide(slide) {
    if (!slide) return;
    const i = liveSlides().indexOf(slide);
    const old = rail.querySelectorAll('.ed-thumb')[i];
    if (old) old.replaceWith(makeThumb(slide, i));
    highlightThumb();
  }

  let suppressClick = false;
  rail.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    const t = e.target.closest('.ed-thumb'); if (!t) return;
    const i = +t.dataset.idx;
    const btn = e.target.closest('button');
    const s = liveSlides();
    if (!btn) { edShow(i); return; }
    const act = btn.dataset.act;
    if (act === 'up' && i > 0) { pushUndo(); s[i - 1].before(s[i]); structural(); edShow(i - 1); }
    else if (act === 'down' && i < s.length - 1) { pushUndo(); s[i + 1].after(s[i]); structural(); edShow(i + 1); }
    else if (act === 'dup') {
      pushUndo();
      const c = s[i].cloneNode(true);
      c.classList.remove('active');
      delete c.dataset.srcIdx;
      c.dataset.edDirty = '1';
      s[i].after(c); structural(); edShow(i + 1);
    } else if (act === 'del') {
      if (s.length === 1) return;
      if (!confirm('Delete slide ' + (i + 1) + '?')) return;
      pushUndo(); s[i].remove(); structural(); edShow(Math.min(i, s.length - 2));
    }
  });

  /* drag to reorder */
  let drag = null;
  rail.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const t = e.target.closest('.ed-thumb'); if (!t) return;
    drag = { t, startY: e.clientY, idx: +t.dataset.idx, moved: false, drop: -1 };
    t.setPointerCapture(e.pointerId);
  });
  rail.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dy) < 6) return;
    drag.moved = true;
    drag.t.classList.add('ed-dragging');
    drag.t.style.transform = 'translateY(' + dy + 'px)';
    const thumbs = [...rail.querySelectorAll('.ed-thumb')];
    let drop = thumbs.length;
    for (let j = 0; j < thumbs.length; j++) {
      if (thumbs[j] === drag.t) continue;
      const r = thumbs[j].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { drop = j; break; }
    }
    drag.drop = drop;
    thumbs.forEach((x, j) => x.classList.toggle('ed-drop-before', j === drop && x !== drag.t));
  });
  function endDrag(commit) {
    if (!drag) return;
    const { t, idx, moved, drop } = drag; drag = null;
    t.classList.remove('ed-dragging'); t.style.transform = '';
    rail.querySelectorAll('.ed-drop-before').forEach((x) => x.classList.remove('ed-drop-before'));
    if (!moved) return;
    suppressClick = true;
    if (!commit || drop < 0 || drop === idx || drop === idx + 1) return;
    pushUndo();
    const s = liveSlides();
    deck.insertBefore(s[idx], s[drop] || null);
    structural();
    edShow(liveSlides().indexOf(s[idx]));
  }
  rail.addEventListener('pointerup', () => endDrag(true));
  rail.addEventListener('pointercancel', () => endDrag(false));

  /* re-render a slide's thumbnail after editing its text */
  deck.addEventListener('focusout', (e) => {
    if (!e.target.isContentEditable) return;
    const slide = e.target.closest('.slide'); if (!slide) return;
    const i = liveSlides().indexOf(slide);
    const old = rail.querySelectorAll('.ed-thumb')[i];
    if (old) old.replaceWith(makeThumb(slide, i));
    highlightThumb();
  });

  /* ---------- image replace (file / drop / paste / link, one affordance) ---------- */
  const MAX_IMG_DIM = 1600;
  const imgBar = el('div', 'ed-imgbar'); imgBar.dataset.edUi = '';
  imgBar.innerHTML =
    '<div class="ed-imgbar-label">Replace image</div>' +
    '<div class="ed-imgbar-main">' +
      '<button type="button" class="ed-imgbar-drop" data-imgact="file">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11"/><path d="M8 10l4 4 4-4"/><path d="M5 16v2a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-2"/></svg>' +
        '<span class="ed-imgbar-drop-title">Drag &amp; drop image or video</span>' +
        '<span class="ed-imgbar-drop-sub">or click to upload</span>' +
      '</button>' +
      '<button type="button" class="ed-imgbar-linkbtn" data-imgact="link">Paste a link instead</button>' +
    '</div>' +
    '<div class="ed-imgbar-link" style="display:none">' +
      '<input type="text" class="ed-imgbar-input" placeholder="Paste image or video URL, press Enter">' +
      '<button type="button" class="ed-imgbar-linkbtn ed-imgbar-cancel">Go back</button>' +
    '</div>';
  document.body.appendChild(imgBar);
  const imgMain = imgBar.querySelector('.ed-imgbar-main');
  const linkBox = imgBar.querySelector('.ed-imgbar-link');
  const linkInput = imgBar.querySelector('.ed-imgbar-input');
  const cancelBtn = imgBar.querySelector('.ed-imgbar-cancel');
  let hoverImg = null, linkMode = false;

  function placeImgBar(img) {
    const r = img.getBoundingClientRect();
    imgBar.style.left = (r.left + r.width / 2) + 'px';
    imgBar.style.top = (r.top + r.height / 2) + 'px';
    imgBar.style.display = 'flex';
  }
  function hideImgBar() { imgBar.style.display = 'none'; hoverImg = null; if (linkMode) exitLinkMode(); }

  // inline URL entry (native prompt() is unreliable; Chrome can suppress it)
  function enterLinkMode() {
    linkMode = true;
    imgMain.style.display = 'none';
    linkBox.style.display = 'flex';
    linkInput.value = '';
    linkInput.focus();
  }
  function exitLinkMode() {
    linkMode = false;
    imgMain.style.display = '';
    linkBox.style.display = 'none';
  }
  linkInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { const img = hoverImg, url = linkInput.value; exitLinkMode(); if (img && url) setImageFromURL(img, url); }
    else if (e.key === 'Escape') exitLinkMode();
  });
  linkInput.addEventListener('blur', exitLinkMode);
  cancelBtn.addEventListener('mousedown', (e) => e.preventDefault());
  cancelBtn.addEventListener('click', exitLinkMode);

  function refreshThumbFor(img) {
    const slide = img.closest('.slide');
    if (slide) {
      slide.dataset.edDirty = '1';
      const i = liveSlides().indexOf(slide);
      const old = rail.querySelectorAll('.ed-thumb')[i];
      if (old) old.replaceWith(makeThumb(slide, i));
      highlightThumb();
    }
    markDirty();
  }

  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
  }

  // oversized images get downscaled so the embedded base64 stays reasonable
  function shrinkDataURL(dataURL, type) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        const max = Math.max(im.naturalWidth, im.naturalHeight);
        if (max <= MAX_IMG_DIM) { res(dataURL); return; }
        const k = MAX_IMG_DIM / max;
        const cv = el('canvas');
        cv.width = Math.round(im.naturalWidth * k);
        cv.height = Math.round(im.naturalHeight * k);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        res(cv.toDataURL(/png/i.test(type) ? 'image/png' : 'image/jpeg', 0.85));
      };
      im.onerror = () => res(dataURL);
      im.src = dataURL;
    });
  }

  const MAX_VIDEO_BYTES = 30 * 1024 * 1024;

  // swap an <img> for a <video> (or back) in place, preserving class/style
  function asVideo(node) {
    if (node.tagName === 'VIDEO') return node;
    const v = document.createElement('video');
    ['autoplay', 'loop', 'muted', 'playsinline'].forEach((a) => v.setAttribute(a, ''));
    v.muted = true;
    const st = node.getAttribute('style'); if (st) v.setAttribute('style', st);
    if (node.className) v.className = node.className;
    node.replaceWith(v);
    return v;
  }
  function asImage(node) {
    if (node.tagName === 'IMG') return node;
    const im = document.createElement('img'); im.alt = ''; im.draggable = false;
    const st = node.getAttribute('style'); if (st) im.setAttribute('style', st);
    if (node.className) im.className = node.className;
    node.replaceWith(im);
    return im;
  }

  // user files embed as base64 to keep the deck self-contained
  async function setImageFromFile(node, file) {
    if (!file) return;
    const isVid = /^video\//.test(file.type);
    if (!isVid && !/^image\//.test(file.type)) { status('That is not an image or video file'); return; }
    if (isVid && file.size > MAX_VIDEO_BYTES) { status('Video is too large to embed (max 30MB). Use a link instead.'); return; }
    status(isVid ? 'Embedding video...' : 'Embedding image...');
    try {
      const data = isVid ? await readAsDataURL(file) : await shrinkDataURL(await readAsDataURL(file), file.type);
      pushUndo();
      const elx = isVid ? asVideo(node) : asImage(node);
      elx.src = data;
      if (hoverImg === node) hoverImg = elx;
      refreshThumbFor(elx);
      status(isVid ? 'Video added' : 'Image replaced'); setTimeout(() => status('Edit mode'), 1500);
    } catch (err) { console.error(err); status('Could not add media'); }
  }

  // pasted or dropped links stay as URLs (matches the deck media convention)
  function setImageFromURL(node, url) {
    url = (url || '').trim();
    if (!/^(https?:\/\/|data:(image|video)\/)/i.test(url)) { status('That is not a valid image or video URL'); return; }
    const isVid = /^data:video\//i.test(url) || /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(url);
    pushUndo();
    const elx = isVid ? asVideo(node) : asImage(node);
    elx.src = url;
    if (hoverImg === node) hoverImg = elx;
    refreshThumbFor(elx);
    status(isVid ? 'Video linked' : 'Image linked'); setTimeout(() => status('Edit mode'), 1500);
  }

  function pickImageFile(node) {
    if (saving) return;
    const inp = el('input'); inp.type = 'file'; inp.accept = 'image/*,video/*';
    inp.addEventListener('change', () => { if (inp.files && inp.files[0]) setImageFromFile(node, inp.files[0]); });
    inp.click();
  }

  document.addEventListener('pointermove', (e) => {
    if (drag || linkMode || moveState || rezState) return;
    if (e.target.closest && e.target.closest('.ed-imgbar')) return;
    const img = e.target.closest && e.target.closest('.deck .slide img, .deck .slide video');
    if (img) { hoverImg = img; placeImgBar(img); }
    else if (imgBar.style.display !== 'none') hideImgBar();
  }, true);

  imgBar.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !hoverImg) return;
    if (b.dataset.imgact === 'link') enterLinkMode();
    else if (b.dataset.imgact === 'file') pickImageFile(hoverImg);
  });

  // drop works over the image and over the centered card (maps to the hovered image)
  function dropTargetImg(e) {
    if (!e.target.closest) return null;
    if (e.target.closest('.ed-imgbar')) return hoverImg;
    return e.target.closest('.deck .slide img, .deck .slide video');
  }
  document.addEventListener('dragover', (e) => {
    const img = dropTargetImg(e); if (!img) return;
    e.preventDefault(); img.classList.add('ed-img-drag');
    imgBar.classList.toggle('ed-drag-active', !!(e.target.closest && e.target.closest('.ed-imgbar')));
  });
  document.addEventListener('dragleave', (e) => {
    const img = dropTargetImg(e); if (img) img.classList.remove('ed-img-drag');
  });
  document.addEventListener('drop', (e) => {
    const img = dropTargetImg(e); if (!img) return;
    e.preventDefault(); img.classList.remove('ed-img-drag'); imgBar.classList.remove('ed-drag-active');
    const dt = e.dataTransfer; if (!dt) return;
    if (dt.files && dt.files.length) setImageFromFile(img, dt.files[0]);
    else setImageFromURL(img, dt.getData('text/uri-list') || dt.getData('text/plain'));
  });

  document.addEventListener('paste', (e) => {
    if (!hoverImg || linkMode) return;
    if (document.activeElement && document.activeElement.isContentEditable) return;
    const dt = e.clipboardData; if (!dt) return;
    for (const f of dt.files) { if (/^image\//.test(f.type)) { e.preventDefault(); setImageFromFile(hoverImg, f); return; } }
    const text = dt.getData('text');
    if (text && /^(https?:\/\/|data:image\/)/i.test(text.trim())) { e.preventDefault(); setImageFromURL(hoverImg, text); }
  });

  /* ---------- element selection + free-position drag / resize ----------
     Opt-in per element: a plain click selects (and text stays editable); an
     actual pointer-drag past a small threshold converts the block to
     position:absolute and moves it. Handles resize; arrows nudge; Delete
     removes; Escape deselects. Snap guides catch slide edges + centre. Every
     mutation flags the slide dirty so the splice save carries the inline styles. */
  const DRAG_THRESH = 6, SNAP = 6, MIN_SIZE = 20;
  // blocks worth selecting: direct children of the slide or of a layout container
  const CONTAINER_SEL = '.slide, .cover-body, .titlebar, .two-col, .two-col-3-2, ' +
    '.cards-2x3, .stat-grid, .pipeline, .deck';
  let selected = null;
  let moveState = null, rezState = null;
  let nudgeSession = 0;

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const selBox = el('div', 'ed-selbox'); selBox.dataset.edUi = '';
  selBox.style.display = 'none';
  for (const h of HANDLES) { const hd = el('div', 'ed-handle ed-h-' + h); hd.dataset.h = h; selBox.appendChild(hd); }
  document.body.appendChild(selBox);
  const vGuide = el('div', 'ed-guide v'); vGuide.dataset.edUi = ''; vGuide.style.display = 'none';
  const hGuide = el('div', 'ed-guide h'); hGuide.dataset.edUi = ''; hGuide.style.display = 'none';
  document.body.append(vGuide, hGuide);

  // scale factor when the deck is CSS-scaled (rendered width vs layout width)
  function slideScale(slide) {
    const r = slide.getBoundingClientRect();
    const w = slide.offsetWidth || r.width;
    return w ? r.width / w : 1;
  }

  // nearest selectable block: topmost element whose parent is the slide or a container
  function pickBlock(target, slide) {
    let n = target, best = null;
    while (n && n !== slide && slide.contains(n)) {
      if (n.nodeType === 1) {
        if (n.matches('.footer, .pagenum, .source') || n.closest('[data-ed-ui]')) return null;
        best = n;
        const p = n.parentElement;
        if (p && (p === slide || p.matches(CONTAINER_SEL))) return n;
      }
      n = n.parentElement;
    }
    return best;
  }

  function positionSel() {
    if (!selected || !document.contains(selected) || !selected.closest('.slide.active')) { hideSel(); return; }
    const r = selected.getBoundingClientRect();
    selBox.style.left = r.left + 'px';
    selBox.style.top = r.top + 'px';
    selBox.style.width = r.width + 'px';
    selBox.style.height = r.height + 'px';
    selBox.style.display = 'block';
  }
  function selectEl(elm) { selected = elm; positionSel(); }
  function hideSel() { selected = null; selBox.style.display = 'none'; hideGuides(); }
  function hideGuides() { vGuide.style.display = 'none'; hGuide.style.display = 'none'; }
  function showV(slide, x) {
    const r = slide.getBoundingClientRect(), sc = slideScale(slide);
    vGuide.style.left = (r.left + x * sc) + 'px';
    vGuide.style.top = r.top + 'px';
    vGuide.style.height = r.height + 'px';
    vGuide.style.display = 'block';
  }
  function showH(slide, y) {
    const r = slide.getBoundingClientRect(), sc = slideScale(slide);
    hGuide.style.top = (r.top + y * sc) + 'px';
    hGuide.style.left = r.left + 'px';
    hGuide.style.width = r.width + 'px';
    hGuide.style.display = 'block';
  }

  // convert a block to free positioning, capturing its current in-flow geometry
  function ensureFree(elm, withHeight) {
    if (elm.style.position !== 'absolute') {
      // F4: pulling a flex/grid child out of flow can collapse the parent and make its
      // siblings jump. If the parent is a layout container that still has siblings, pin
      // its current height first. The inline min-height persists in the saved HTML,
      // which is acceptable — it preserves the visual layout.
      const parent = elm.parentElement;
      if (parent && parent.matches(CONTAINER_SEL) && parent.children.length > 1 && !parent.style.minHeight) {
        parent.style.minHeight = parent.offsetHeight + 'px';
      }
      // Geometry note (verified — do NOT "fix"): the layout containers in CONTAINER_SEL
      // are unpositioned, so elm.offsetParent is the slide. left/top from offsetLeft/
      // offsetTop are therefore already relative to the same box position:absolute
      // resolves against, so the block stays put on the first drag.
      const l = elm.offsetLeft, t = elm.offsetTop, w = elm.offsetWidth, h = elm.offsetHeight;
      elm.style.position = 'absolute';
      elm.style.margin = '0';
      elm.style.left = l + 'px';
      elm.style.top = t + 'px';
      elm.style.width = w + 'px';
      if (withHeight) elm.style.height = h + 'px';
    } else if (withHeight && !elm.style.height) {
      elm.style.height = elm.offsetHeight + 'px';
    }
  }

  function deleteSelected() {
    if (!selected) return;
    const slide = selected.closest('.slide');
    pushUndo();
    selected.remove();
    hideSel();
    if (slide) { slide.dataset.edDirty = '1'; refreshThumbSlide(slide); }
    markDirty();
  }

  function nudge(key, step) {
    const slide = selected.closest('.slide'); if (!slide) return;
    const now = Date.now();
    if (now - nudgeSession > 600) pushUndo();
    nudgeSession = now;
    ensureFree(selected, false);
    let l = parseFloat(selected.style.left) || 0, t = parseFloat(selected.style.top) || 0;
    if (key === 'ArrowLeft') l -= step; else if (key === 'ArrowRight') l += step;
    else if (key === 'ArrowUp') t -= step; else if (key === 'ArrowDown') t += step;
    selected.style.left = l + 'px'; selected.style.top = t + 'px';
    slide.dataset.edDirty = '1';
    positionSel(); markDirty();
  }

  // move: snap left/top to slide edges + centre, draw guides when within SNAP
  function moveApply(m, nl, nt) {
    const slide = m.slide, cw = slide.clientWidth, ch = slide.clientHeight;
    const ew = selected.offsetWidth, eh = selected.offsetHeight;
    hideGuides();
    for (const [p, gx] of [[0, 0], [(cw - ew) / 2, cw / 2], [cw - ew, cw]]) {
      if (Math.abs(nl - p) <= SNAP) { nl = p; showV(slide, gx); break; }
    }
    for (const [p, gy] of [[0, 0], [(ch - eh) / 2, ch / 2], [ch - eh, ch]]) {
      if (Math.abs(nt - p) <= SNAP) { nt = p; showH(slide, gy); break; }
    }
    selected.style.left = nl + 'px';
    selected.style.top = nt + 'px';
    positionSel();
  }

  // pointerdown on a block: arm a potential move (don't hijack caret/click yet)
  deck.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-ed-ui]')) return;
    const slide = e.target.closest('.slide');
    if (!slide || !deck.contains(slide)) return;
    const block = pickBlock(e.target, slide);
    if (!block) { hideSel(); return; }
    // F1: don't hijack native text selection. Arm the move, but record whether the
    // pointer landed inside a text field and whether this block was already selected.
    // A click still selects (pointerup below); a *drag* only starts moving when the
    // block is already selected — so a first drag over text selects text natively.
    const editableHit = !!(e.target.closest && e.target.closest('[contenteditable]'));
    moveState = { block, slide, startX: e.clientX, startY: e.clientY, moved: false,
      pointerId: e.pointerId, scale: slideScale(slide),
      editableHit, wasSelected: block === selected };
  });

  document.addEventListener('pointermove', (e) => {
    if (!moveState || rezState) return;
    const dx0 = e.clientX - moveState.startX, dy0 = e.clientY - moveState.startY;
    if (!moveState.moved) {
      if (Math.abs(dx0) < DRAG_THRESH && Math.abs(dy0) < DRAG_THRESH) return;
      // F1: a drag beginning inside a not-yet-selected text field is a native text
      // selection, not a move — abandon the armed move and let the browser select.
      if (moveState.editableHit && !moveState.wasSelected) { moveState = null; return; }
      moveState.moved = true;
      pushUndo();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      const s = window.getSelection && window.getSelection(); if (s) s.removeAllRanges();
      selected = moveState.block;
      ensureFree(moveState.block, false);
      moveState.l = parseFloat(moveState.block.style.left) || 0;
      moveState.t = parseFloat(moveState.block.style.top) || 0;
      moveState.slide.dataset.edDirty = '1';
      try { moveState.block.setPointerCapture(moveState.pointerId); } catch (err) {}
      document.body.style.userSelect = 'none';
    }
    e.preventDefault();
    moveApply(moveState, moveState.l + dx0 / moveState.scale, moveState.t + dy0 / moveState.scale);
  }, true);

  document.addEventListener('pointerup', (e) => {
    if (!moveState) return;
    const m = moveState; moveState = null;
    document.body.style.userSelect = '';
    hideGuides();
    if (!m.moved) { selectEl(m.block); return; } // treated as a click → select
    try { m.block.releasePointerCapture(e.pointerId); } catch (err) {}
    markDirty(); refreshThumbSlide(m.slide); positionSel();
  }, true);

  // resize handles (children of selBox, outside .deck → their own pointerdown)
  selBox.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.ed-handle'); if (!h || !selected) return;
    e.preventDefault(); e.stopPropagation();
    const slide = selected.closest('.slide'); if (!slide) return;
    pushUndo();
    ensureFree(selected, true);
    rezState = { dir: h.dataset.h, slide, startX: e.clientX, startY: e.clientY, scale: slideScale(slide),
      l: parseFloat(selected.style.left) || 0, t: parseFloat(selected.style.top) || 0,
      w: parseFloat(selected.style.width) || selected.offsetWidth,
      hgt: parseFloat(selected.style.height) || selected.offsetHeight };
    slide.dataset.edDirty = '1';
    try { h.setPointerCapture(e.pointerId); } catch (err) {}
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('pointermove', (e) => {
    if (!rezState) return;
    e.preventDefault();
    const d = rezState.dir;
    const dx = (e.clientX - rezState.startX) / rezState.scale;
    const dy = (e.clientY - rezState.startY) / rezState.scale;
    let l = rezState.l, t = rezState.t, w = rezState.w, h = rezState.hgt;
    if (d.includes('e')) w = rezState.w + dx;
    if (d.includes('s')) h = rezState.hgt + dy;
    if (d.includes('w')) { w = rezState.w - dx; l = rezState.l + dx; }
    if (d.includes('n')) { h = rezState.hgt - dy; t = rezState.t + dy; }
    if (w < MIN_SIZE) { if (d.includes('w')) l -= (MIN_SIZE - w); w = MIN_SIZE; }
    if (h < MIN_SIZE) { if (d.includes('n')) t -= (MIN_SIZE - h); h = MIN_SIZE; }
    selected.style.left = l + 'px'; selected.style.top = t + 'px';
    selected.style.width = w + 'px'; selected.style.height = h + 'px';
    positionSel();
  }, true);

  document.addEventListener('pointerup', (e) => {
    if (!rezState) return;
    const r = rezState; rezState = null;
    document.body.style.userSelect = '';
    try { e.target.releasePointerCapture && e.target.releasePointerCapture(e.pointerId); } catch (err) {}
    markDirty(); refreshThumbSlide(r.slide); positionSel();
  }, true);

  addEventListener('scroll', () => { if (selected) positionSel(); }, true);
  addEventListener('resize', () => { if (selected) positionSel(); });

  /* ---------- toolbar ---------- */
  const SAVE_TITLE = 'Save (Cmd/Ctrl+S). Autosaves as you edit; served decks save to the vault, local files ask to pick the file once.';
  function mainToolbarHTML() {
    return '<span class="ed-status" id="edStatus">Edit mode</span>' +
      '<button class="ed-icon" id="edUndo" title="Undo (Cmd/Ctrl+Z)" aria-label="Undo">↶</button>' +
      '<button class="ed-icon" id="edRedo" title="Redo (Shift+Cmd/Ctrl+Z or Ctrl+Y)" aria-label="Redo">↷</button>' +
      '<button class="ed-save" id="edSave" title="' + SAVE_TITLE + '">Save</button>' +
      '<button id="edExit">Exit</button>';
  }
  function bindMainToolbar() {
    $('edUndo').addEventListener('click', popUndo);
    $('edRedo').addEventListener('click', popRedo);
    $('edSave').addEventListener('click', doSave);
    $('edExit').addEventListener('click', handleExit);
    updateUndoButtons();
  }
  const bar = el('div', 'ed-toolbar'); bar.dataset.edUi = '';
  bar.innerHTML = mainToolbarHTML();
  document.body.appendChild(bar);
  bindMainToolbar();

  function showExitConfirm() {
    bar.innerHTML = '<span class="ed-status">Unsaved changes</span>' +
      '<button id="edDiscard">Discard & Exit</button>' +
      '<button id="edCancel">Cancel</button>';
    $('edDiscard').addEventListener('click', () => {
      structuralChanged = false;
      deck.querySelectorAll('[data-ed-dirty]').forEach((s) => delete s.dataset.edDirty);
      location.href = location.pathname;
    });
    $('edCancel').addEventListener('click', restoreToolbar);
  }

  function restoreToolbar() {
    bar.innerHTML = mainToolbarHTML();
    bindMainToolbar();
    markDirty();
  }

  // shown when in-place saving is not possible (Safari, or a restricted folder)
  function offerDownload(msg) {
    bar.innerHTML = '<span class="ed-status" id="edStatus">' + msg + '</span>' +
      '<button class="ed-save" id="edDl">Download copy</button>' +
      '<button id="edBack">Back</button>';
    $('edDl').addEventListener('click', () => { downloadCopy(); setTimeout(restoreToolbar, 1200); });
    $('edBack').addEventListener('click', restoreToolbar);
  }

  function handleExit() {
    if (!hasChanges()) { location.href = location.pathname; return; }
    showExitConfirm();
  }

  function status(msg) { const s = $('edStatus'); if (s) s.textContent = msg; }

  addEventListener('beforeunload', (e) => { if (hasChanges()) e.preventDefault(); });

  /* ---------- auto-save (debounced, only when file handle exists) ---------- */
  async function autoSave() {
    if (!hasChanges() || saving) return;
    if (deriveVaultPath()) { await serverSave(false); return; } // logged server path
    if (!fileHandle) return;
    saving = true;
    status('Saving...');
    let needsResave = false;
    try {
      const src = await (await fileHandle.getFile()).text();
      const seqAtSave = editSeq;   // F2: snapshot the edit counter as we serialize
      const out = splice(src);
      if (out == null) { status('Auto-save skipped (file changed externally)'); saving = false; return; }
      const w = await fileHandle.createWritable();
      await w.write(out); await w.close();
      // F2: keep dirty state if edits landed while the write was in flight.
      if (editSeq === seqAtSave) {
        reanchor();
        status('Saved');
        setTimeout(() => status('Edit mode'), 1500);
      } else {
        needsResave = true;
        status('Saved — writing newer edits…');
        setTimeout(() => status('Edit mode'), 1500);
      }
    } catch (err) {
      console.error('Auto-save failed:', err);
      status('Auto-save failed');
      setTimeout(() => status('Edit mode'), 3000);
    }
    saving = false;
    if (needsResave) scheduleAutoSave();
  }

  /* ---------- save: File System Access + slide-anchored splice ---------- */
  const IDB_KEY = 'deckHandle:' + location.pathname;
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      const o = indexedDB.open('deck-edit', 1);
      o.onupgradeneeded = () => o.result.createObjectStore('kv');
      o.onerror = () => rej(o.error);
      o.onsuccess = () => {
        const tx = o.result.transaction('kv', mode);
        const r = fn(tx.objectStore('kv'));
        tx.oncomplete = () => res(r && r.result);
        tx.onerror = () => rej(tx.error);
      };
    });
  }

  async function getHandle() {
    if (!fileHandle) fileHandle = await idb('readonly', (s) => s.get(IDB_KEY)).catch(() => null);
    if (fileHandle) {
      let p = await fileHandle.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted') p = await fileHandle.requestPermission({ mode: 'readwrite' });
      if (p !== 'granted') fileHandle = null;
    }
    if (!fileHandle) {
      const pageName = decodeURIComponent(location.pathname.split('/').pop());
      status('One-time: select "' + pageName + '" in the dialog to allow in-place saving');
      [fileHandle] = await showOpenFilePicker({
        id: 'deck-edit',
        types: [{ description: 'HTML deck', accept: { 'text/html': ['.html'] } }],
      });
      if (fileHandle.name !== pageName &&
          !confirm('Picked "' + fileHandle.name + '" but this page is "' + pageName + '". Overwrite it anyway?')) {
        fileHandle = null; throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      }
      await idb('readwrite', (s) => s.put(fileHandle, IDB_KEY)).catch(() => {});
      justPicked = true;
    }
    return fileHandle;
  }

  function serializeClean(section) {
    const c = section.cloneNode(true);
    c.querySelectorAll('[data-ed-wrap]').forEach((w) => w.replaceWith(document.createTextNode(w.textContent)));
    for (const n of [c, ...c.querySelectorAll('*')]) {
      n.removeAttribute('contenteditable');
      n.removeAttribute('spellcheck');
      delete n.dataset.edDirty;
      delete n.dataset.srcIdx;
      n.classList.remove('active');
      if (!n.getAttribute('class')) n.removeAttribute('class');
    }
    // Robin decks sit at column 0 — no leading indent, so diffs stay minimal.
    return c.outerHTML;
  }

  // Strip any `active`, then (for the first slide only) append it — appending
  // rather than reinserting keeps the class order of an unchanged cover byte-stable.
  function ensureActive(body, isFirst) {
    return body.replace(/<section([^>]*?)class="([^"]*)"/, (m, pre, cls) => {
      const list = cls.split(/\s+/).filter((x) => x && x !== 'active');
      if (isFirst) list.push('active');
      return '<section' + pre + 'class="' + list.join(' ') + '"';
    });
  }

  // Replace only edited slides in the on-disk source; head (robin:meta + styles)
  // and tail (scripts) always pass through byte-identical.
  function splice(src) {
    const re = /^([ \t]*)<section class="slide[^>]*>[\s\S]*?\n\1<\/section>/gm;
    const ms = [...src.matchAll(re)];
    if (ms.length !== baseCount) return null;
    const live = liveSlides();

    // Fast path — no structural change: every live slide still maps to its original
    // source slot, in order. Rewrite only dirty slide bodies; every gap between
    // slides (comments, section dividers, blank lines) survives byte-for-byte.
    const simple = live.length === ms.length &&
      live.every((s, i) => s.dataset.srcIdx !== undefined && +s.dataset.srcIdx === i);
    if (simple) {
      let out = '', pos = 0;
      ms.forEach((m, k) => {
        out += src.slice(pos, m.index);
        const s = live[k];
        const body = s.dataset.edDirty ? serializeClean(s) : m[0];
        out += ensureActive(body, k === 0);
        pos = m.index + m[0].length;
      });
      return out + src.slice(pos);
    }

    // Structural path — slides reordered / inserted / deleted. Each slide carries
    // the single comment line immediately above its original position; purely
    // positional dividers between slides can't be reattached and are dropped.
    const chunks = []; let pos = 0;
    for (const m of ms) {
      const prefix = src.slice(pos, m.index);
      const cm = prefix.match(/\n([ \t]*<!--[^\n]*-->)[ \t]*\n?$/);
      chunks.push({
        comment: cm ? cm[1] : null,
        body: m[0],
        headFree: pos === 0 ? prefix.slice(0, cm ? cm.index : prefix.length) : null,
      });
      pos = m.index + m[0].length;
    }
    const tail = src.slice(pos);
    let out = (chunks[0].headFree || '').replace(/\s*$/, '\n');
    live.forEach((s, i) => {
      const ch = s.dataset.srcIdx !== undefined ? chunks[+s.dataset.srcIdx] : null;
      const comment = ch ? ch.comment : '<!' + '-- new slide --' + '>';
      let body = (ch && !s.dataset.edDirty) ? ch.body : serializeClean(s);
      body = ensureActive(body, i === 0);
      out += '\n' + (comment ? comment + '\n' : '') + body + '\n';
    });
    out += tail.replace(/^\s*\n/, '\n');
    return out;
  }

  function downloadCopy() {
    const dc = document.documentElement.cloneNode(true);
    dc.querySelectorAll('[data-ed-ui]').forEach((n) => n.remove());
    dc.querySelectorAll('[data-ed-wrap]').forEach((w) => w.replaceWith(w.textContent));
    dc.querySelectorAll('[contenteditable]').forEach((n) => {
      n.removeAttribute('contenteditable'); n.removeAttribute('spellcheck');
    });
    dc.querySelectorAll('[data-ed-dirty], [data-src-idx]').forEach((n) => {
      delete n.dataset.edDirty; delete n.dataset.srcIdx;
    });
    dc.querySelector('body').classList.remove('ed-on', 'ed-dark');
    const html = '<!DOCTYPE html>\n' + dc.outerHTML;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = decodeURIComponent(location.pathname.split('/').pop() || 'deck.html');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status('Downloaded updated copy');
  }

  // dispatcher: prefer the logged server path when the vault path is derivable,
  // otherwise fall back to the File System Access flow.
  function doSave() {
    if (saving) return;
    if (deriveVaultPath()) { serverSave(true); return; }
    fsaSave();
  }

  async function fsaSave() {
    if (saving) return;
    saving = true;
    let needsResave = false;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    try {
      if (!window.showOpenFilePicker) {
        offerDownload('This browser saves a copy instead of writing in place. In-place saving needs Chrome or Edge.');
        return;
      }
      const h = await getHandle();
      const src = await (await h.getFile()).text();
      const seqAtSave = editSeq;   // F2: snapshot the edit counter as we serialize
      const out = splice(src);
      if (out == null) {
        if (confirm('The file on disk has a different slide count than when this page loaded ' +
            '(someone else edited it?). In-place merge is unsafe. Download an updated copy instead?')) downloadCopy();
        return;
      }
      const w = await h.createWritable();
      await w.write(out); await w.close();
      // F2: only re-anchor (and clear dirty) if nothing was edited while the write was
      // in flight; otherwise keep the newer edits and save them on the next pass.
      if (editSeq === seqAtSave) {
        reanchor();   // re-anchor against the file we just wrote
        status(justPicked ? 'Saved. Auto-save is now active.' : 'Saved');
        setTimeout(() => status('Edit mode'), justPicked ? 4000 : 1500);
      } else {
        needsResave = true;
        status('Saved — writing newer edits…');
        setTimeout(() => status('Edit mode'), 1500);
      }
      justPicked = false;
    } catch (err) {
      if (err && err.name === 'AbortError') { offerDownload('Could not save in place here. Download an updated copy instead?'); return; }
      if (err && err.name === 'SecurityError') { status('Timed out waiting — click Save again'); return; }
      if (err && /already active/i.test(err.message || '')) { status('A file dialog is already open. Finish it, then save again.'); return; }
      console.error(err);
      offerDownload('Save failed: ' + (err && err.message) + '. Download an updated copy instead?');
    } finally {
      saving = false;
      if (needsResave) scheduleAutoSave();   // F2: flush edits that landed mid-write
    }
  }

  /* ---------- init ---------- */
  liveSlides().forEach((s, i) => { s.dataset.srcIdx = i; });
  baseCount = liveSlides().length;
  // native HTML5 image drag would race the free-position pointer move — disable it
  deck.querySelectorAll('.slide img').forEach((im) => { im.draggable = false; });
  makeEditable(deck);
  watchMutations();
  renderRail();
  edShow(Math.max(0, curIdx()));
  markDirty();
})();
