/* ============================================================
   Full Catalog — 57-page PDF flipbook.

   Rasterised in the browser with the vendored PDF.js build that sits in
   vendor/pdfjs/. Nothing is fetched from the network: every URL below is
   derived from document.baseURI, so the same file works at the site root,
   inside a sub-path, or on a local preview server.

   app.js imports this module lazily — the 328 KB library and the 1.3 MB
   worker are only ever pulled in when the reader opens this edition.

   Pages are laid out as "screens": the first page stands alone, the rest
   pair up two at a time. Each screen is a .pdf-row of one or two .pdf-slot
   elements; a slot rasterises itself when it comes near the viewport.
   ============================================================ */

const BASE = document.baseURI;
const LIB_URL = new URL('vendor/pdfjs/pdf.min.mjs', BASE).href;
const WORKER_URL = new URL('vendor/pdfjs/pdf.worker.min.mjs', BASE).href;
const PDF_URL = new URL('assets/catalog/Peterpower-Catalog-57p.pdf', BASE).href;

const PRELOAD = 4;        // the first paint renders exactly these pages
const CACHE_LIMIT = 12;   // rasterised pages kept in memory
const GAP = 8;
const PAD = 14;
const SINGLE_MAX = 768;   // <= this width never pairs pages
const MAX_DPR = 2;

export async function mount(opts) {
  const host = opts.host;
  const stage = opts.stage;
  const onState = opts.onState || function () {};

  let lib;
  try {
    lib = await import(LIB_URL);
  } catch (err) {
    throw tag(new Error('pdf.js could not be loaded'), 'engine');
  }
  lib.GlobalWorkerOptions.workerSrc = WORKER_URL;

  let doc;
  try {
    doc = await lib.getDocument({ url: PDF_URL }).promise;
  } catch (err) {
    throw tag(new Error('the catalog pdf could not be opened'), 'document');
  }

  const N = doc.numPages;
  const cache = new Map();      // pageNo -> { w, canvas }
  const pending = new Map();    // pageNo -> Promise<canvas>
  let io = null;
  let view = 'spread';          // 'spread' | 'single' | 'scroll'
  let cur = 1;                  // 1-based page the reader is on
  let box = { w: 320, h: 420, cols: 1 };
  let aspect = 1 / 1.414;
  let gen = 0;                  // bumped whenever cached canvases go stale
  let resizeTimer = 0;

  // 57 pages of the same deck share one page size; page 1 defines it.
  try {
    const probe = await doc.getPage(1).then(function (p) { return p.getViewport({ scale: 1 }); });
    if (probe.height) aspect = probe.width / probe.height;
  } catch (err) { /* keep the A4 fallback */ }

  function tag(err, reason) { err.reason = reason; return err; }

  function paired() { return view === 'spread' && window.innerWidth > SINGLE_MAX; }

  // Screen 0 is the front cover on its own; the rest pair up two at a time so
  // a reader never sees an odd "left page" that is really a right-hand page.
  function screens() {
    const out = [];
    if (!paired()) {
      for (let i = 1; i <= N; i++) out.push([i]);
      return out;
    }
    out.push([1]);
    for (let p = 2; p <= N; p += 2) out.push(p + 1 <= N ? [p, p + 1] : [p]);
    return out;
  }

  function measure() {
    const availW = Math.max(120, stage.clientWidth - PAD * 2);
    const availH = Math.max(120, stage.clientHeight - PAD * 2);
    const cols = paired() ? 2 : 1;
    let w = (availW - (cols - 1) * GAP) / cols;
    let h = w / aspect;
    if (h > availH) { h = availH; w = h * aspect; }
    box = { w: Math.max(80, Math.floor(w)), h: Math.max(100, Math.floor(h)), cols: cols };
    host.style.setProperty('--pdf-w', box.w + 'px');
    host.style.setProperty('--pdf-h', box.h + 'px');
  }

  function rowEl(pages) {
    const row = document.createElement('div');
    row.className = 'pdf-row';
    for (const n of pages) {
      const slot = document.createElement('div');
      slot.className = 'pdf-slot';
      slot.dataset.page = String(n);
      slot.dataset.state = 'idle';
      row.appendChild(slot);
    }
    return row;
  }

  function build() {
    if (io) { io.disconnect(); io = null; }
    stage.replaceChildren();
    const sc = screens();
    const i = sc.findIndex(function (s) { return s.indexOf(cur) !== -1; });
    if (view === 'scroll') {
      const frag = document.createDocumentFragment();
      for (const row of sc) frag.appendChild(rowEl(row));
      stage.appendChild(frag);
    } else {
      stage.appendChild(rowEl(sc[i < 0 ? 0 : i]));
    }
  }

  function observe() {
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      for (const e of entries) if (e.isIntersecting) rasterise(e.target);
    }, { root: stage, rootMargin: '450px 0px' });
    for (const s of stage.querySelectorAll('.pdf-slot')) io.observe(s);
  }

  function remember(n, canvas, g) {
    if (g !== gen) return;
    cache.set(n, { w: box.w, canvas: canvas });
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest === n) break;
      cache.delete(oldest);
    }
  }

  // One rasterisation per page per size, shared by every caller that asks.
  function canvasFor(n) {
    const hit = cache.get(n);
    if (hit && hit.w === box.w) return Promise.resolve(hit.canvas);
    const inflight = pending.get(n);
    if (inflight) return inflight;

    const g = gen;
    const job = doc.getPage(n).then(function (page) {
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const vp = page.getViewport({ scale: (box.w / base.width) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
        .then(function () {
          pending.delete(n);
          remember(n, canvas, g);
          return canvas;
        });
    }).catch(function (err) {
      pending.delete(n);
      throw err;
    });

    pending.set(n, job);
    return job;
  }

  function rasterise(slot) {
    if (!slot.isConnected || slot.dataset.state !== 'idle') return;
    const n = Number(slot.dataset.page);
    const g = gen;
    slot.dataset.state = 'busy';
    canvasFor(n).then(function (canvas) {
      if (!slot.isConnected || g !== gen) { slot.dataset.state = 'idle'; return; }
      slot.replaceChildren(canvas);
      slot.dataset.state = 'done';
    }).catch(function () {
      slot.dataset.state = 'idle';
    });
  }

  function preload() {
    let chain = Promise.resolve();
    for (let n = 1; n <= Math.min(PRELOAD, N); n++) {
      chain = chain.then(function () { return canvasFor(n).catch(function () {}); });
    }
    return chain;
  }

  function scrollToPage(n, behavior) {
    const slot = stage.querySelector('.pdf-slot[data-page="' + n + '"]');
    if (!slot) return;
    stage.scrollTo({ top: Math.max(0, slot.offsetTop - PAD), behavior: behavior || 'auto' });
  }

  function topPage() {
    const slots = stage.querySelectorAll('.pdf-slot');
    for (const s of slots) {
      if (s.offsetTop + s.offsetHeight > stage.scrollTop + 4) return Number(s.dataset.page);
    }
    return 1;
  }

  function state() { return { page: cur, count: N }; }

  function goTo(n) {
    const p = Math.max(1, Math.min(N, Number(n) || 1));
    cur = p;
    if (view === 'scroll') scrollToPage(p, 'auto');
    else { build(); observe(); }
    onState(state());
  }

  function turn(dir) {
    if (view === 'scroll') {
      stage.scrollBy({ top: dir * (box.h + GAP + 10), behavior: 'smooth' });
      return;
    }
    const sc = screens();
    let i = sc.findIndex(function (s) { return s.indexOf(cur) !== -1; });
    if (i < 0) i = 0;
    const next = i + dir;
    if (next < 0 || next >= sc.length) return;
    cur = sc[next][0];
    build();
    observe();
    onState(state());
  }

  function setView(v) {
    if (v !== 'spread' && v !== 'single' && v !== 'scroll') v = 'spread';
    if (v === view) return;
    // leaving the continuous list, the page nearest the top is where the reader is
    if (view === 'scroll') cur = topPage();
    view = v;
    host.dataset.mode = view;
    gen++; cache.clear(); pending.clear();
    measure();
    build();
    observe();
    if (v === 'scroll') scrollToPage(cur, 'auto');
    preload();
    onState(state());
  }

  // Crossing the single/spread breakpoint or any width change invalidates every
  // rasterised canvas, so drop them and re-render whatever is on screen.
  function relayout() {
    gen++; cache.clear(); pending.clear();
    const anchor = view === 'scroll' ? topPage() : cur;
    measure();
    build();
    observe();
    if (view === 'scroll') scrollToPage(anchor, 'auto');
    preload();
    onState(state());
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, 160);
  }
  window.addEventListener('resize', onResize);

  measure();
  build();
  observe();
  preload().then(function () { onState(state()); });

  return {
    state: state,
    turn: turn,
    goTo: goTo,
    setView: setView,
    relayout: relayout,
    currentMode: function () { return view; }
  };
}
