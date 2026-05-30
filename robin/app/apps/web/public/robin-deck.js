/* robin-deck.js — shared navigation for Robin slide decks.
   Drives .slide.active, keeps .pagenum / #counter in sync, and exposes a
   window.robinDeck API so the Robin artifact viewer can control the deck from
   its chrome. Keyboard nav works standalone; click-to-advance is intentionally
   omitted so the viewer can support per-slide comments. */
(function () {
  const slides = Array.from(document.querySelectorAll('.slide'));
  if (!slides.length) return;
  let idx = Math.max(0, slides.findIndex((s) => s.classList.contains('active')));
  if (idx < 0) idx = 0;

  function render() {
    slides.forEach((s, n) => s.classList.toggle('active', n === idx));
    const counter = document.getElementById('counter');
    if (counter) counter.textContent = idx + 1 + ' / ' + slides.length;
    document.querySelectorAll('.pagenum').forEach((el, n) => {
      // only update the page number that lives on the active slide footer
    });
    const active = slides[idx];
    const pn = active && active.querySelector('.pagenum');
    if (pn && !pn.dataset.fixed) pn.textContent = idx + 1 + ' / ' + slides.length;
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
    titles: () =>
      slides.map((s) => {
        const h = s.querySelector('h1, h2');
        const eb = s.querySelector('.eyebrow');
        return ((h && h.textContent) || (eb && eb.textContent) || '').trim();
      }),
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { window.robinDeck.next(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { window.robinDeck.prev(); e.preventDefault(); }
    else if (e.key === 'Home') { show(0); }
    else if (e.key === 'End') { show(slides.length - 1); }
  });

  render();
})();
