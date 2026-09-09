/* robin-deck.js — shared runtime for Robin slide decks.
   Drives .slide.active, keeps .pagenum / #counter / a progress bar in sync, and
   exposes a window.robinDeck API so the Robin artifact viewer can control the
   deck from its chrome. Keyboard + touch nav work standalone; click-to-advance
   is intentionally omitted so the viewer can support per-slide comments.

   Standalone extras (progress bar, F=fullscreen, P=PDF) are suppressed when the
   deck runs inside the Robin viewer (html[data-robin-embed]) — the chrome owns
   that furniture there. On ?edit (standalone only) it loads robin-deck-edit.js. */
(function () {
  const embedded = document.documentElement.hasAttribute('data-robin-embed');
  let slides = Array.from(document.querySelectorAll('.slide'));
  if (!slides.length) return;
  let idx = Math.max(0, slides.findIndex((s) => s.classList.contains('active')));
  if (idx < 0) idx = 0;

  // Thin progress bar — standalone only (the viewer chrome shows its own counter).
  let bar = null;
  if (!embedded) {
    const wrap = document.createElement('div');
    wrap.className = 'deck-progress';
    bar = document.createElement('i');
    wrap.appendChild(bar);
    document.body.appendChild(wrap);
  }

  function render() {
    slides.forEach((s, n) => s.classList.toggle('active', n === idx));
    const counter = document.getElementById('counter');
    if (counter) counter.textContent = idx + 1 + ' / ' + slides.length;
    const active = slides[idx];
    const pn = active && active.querySelector('.pagenum');
    if (pn && !pn.dataset.fixed) pn.textContent = idx + 1 + ' / ' + slides.length;
    if (bar) bar.style.width = ((idx + 1) / slides.length) * 100 + '%';
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent('robin-deck:change', { detail: { index: idx, count: slides.length } }));
  }

  function show(i) {
    idx = Math.max(0, Math.min(slides.length - 1, i));
    render();
  }

  window.robinDeck = {
    show,
    next: () => show(idx + 1),
    prev: () => show(idx - 1),
    get count() { return slides.length; },
    get index() { return idx; },
    // Re-scan the DOM after structural edits (used by the ?edit editor). Prefers
    // direct children of .deck so nested <section>s inside a slide don't count.
    refresh() {
      const scoped = Array.from(document.querySelectorAll('.deck > .slide'));
      slides = scoped.length ? scoped : Array.from(document.querySelectorAll('.slide'));
      if (idx >= slides.length) idx = slides.length - 1;
      if (idx < 0) idx = 0;
      return slides.length;
    },
    titles: () =>
      slides.map((s) => {
        const h = s.querySelector('h1, h2');
        const eb = s.querySelector('.eyebrow');
        return ((h && h.textContent) || (eb && eb.textContent) || '').trim();
      }),
  };

  function toggleFullscreen() {
    const el = document.querySelector('.deck') || document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen();
  }

  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.isContentEditable) return; // let the ?edit editor type
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { window.robinDeck.next(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { window.robinDeck.prev(); e.preventDefault(); }
    else if (e.key === 'Home') { show(0); }
    else if (e.key === 'End') { show(slides.length - 1); }
    else if (!embedded && (e.key === 'f' || e.key === 'F')) { toggleFullscreen(); }
    else if (!embedded && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); window.print(); }
  });

  // Touch / swipe — horizontal drags advance; vertical drags are left to scroll.
  let tsx = 0, tsy = 0;
  const SWIPE = 50;
  document.addEventListener('touchstart', (e) => {
    tsx = e.changedTouches[0].screenX;
    tsy = e.changedTouches[0].screenY;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].screenX - tsx;
    const dy = e.changedTouches[0].screenY - tsy;
    if (Math.abs(dx) < SWIPE || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) window.robinDeck.next();
    else window.robinDeck.prev();
  }, { passive: true });

  render();

  // ?edit editor — standalone only; in-app editing + comments are the viewer's job.
  if (!embedded && new URLSearchParams(location.search).has('edit')) {
    const s = document.createElement('script');
    s.src = '/robin-deck-edit.js';
    s.defer = true;
    document.body.appendChild(s);
  }
})();
