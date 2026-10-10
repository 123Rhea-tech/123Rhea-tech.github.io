/* ============================================================
   Peterpower 2026 B2B Catalog — application logic
   Zero dependencies, zero external requests. Data comes from
   window.CATALOG_DATA (assets/js/data.js, inlined for offline use).
   ============================================================ */
(function () {
  'use strict';

  var DATA = window.CATALOG_DATA;
  var SITE = DATA.site;
  var PRODUCTS = DATA.products;
  var EMAIL = SITE.email;

  // page 0 = cover, pages 1..N = products, page N+1 = back cover
  var PAGE_COUNT = PRODUCTS.length + 2; // 16

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var book = $('book'), scroll = $('scroll'), stage = $('book-stage');
  var pageLeft = $('page-left'), pageRight = $('page-right');
  var flipper = $('flipper'), flipFront = $('flip-front'), flipBack = $('flip-back');
  var thumbDrawer = $('thumb-drawer'), thumbGrid = $('thumb-grid');
  var searchPanel = $('search-panel'), overlay = $('overlay');
  var searchInput = $('search-input'), searchResults = $('search-results');
  var fPower = $('f-power'), fPorts = $('f-ports'), fUsbc = $('f-usbc'), fCat = $('f-cat');
  var pageInput = $('page-input'), pageTotal = $('page-total'), mPage = $('m-page');
  var bookSwitch = $('bookswitch'), pager = document.querySelector('.pager');
  var pdfHost = $('pdfbook'), pdfStage = $('pdf-scroll'), pdfNotice = $('pdf-notice');

  var mode = 'flip';            // 'flip' | 'scroll'
  var current = 0;              // page index (0-based) on the right slot
  var flipping = false;

  // Two editions share one shell: 'interactive' is the built-in 16-page book,
  // 'full' is the 57-page PDF rendered by the lazily imported pdfbook module.
  var activeBook = 'interactive';
  var pdfApi = null;            // Promise for the loaded module, or null
  var pdfReady = null;          // resolved pdfbook handle (or the failed stub)
  var pendingPdfPage = 0;       // deep link target, applied once the PDF opens

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // <=768px is single-page mode: the facing page is never rendered.
  function isSingle() { return window.innerWidth <= 768; }

  // A "screen" is whatever one view shows. The cover and the back cover stand
  // alone and are centred; the pages in between pair up two at a time.
  function buildScreens() {
    var sc = [], i, p;
    if (isSingle()) {
      for (i = 0; i < PAGE_COUNT; i++) sc.push([i]);
      return sc;
    }
    sc.push([0]);
    for (p = 1; p < PAGE_COUNT - 1; p += 2) {
      sc.push(p + 1 < PAGE_COUNT - 1 ? [p, p + 1] : [p]);
    }
    sc.push([PAGE_COUNT - 1]);
    return sc;
  }

  function screenOf(page) {
    var sc = buildScreens();
    for (var i = 0; i < sc.length; i++) {
      if (sc[i].indexOf(page) !== -1) return i;
    }
    return 0;
  }

  function pageW() { return pageRight.offsetWidth || 620; }
  function pageH() { return pageRight.offsetHeight || 760; }

  // ---------- page renderers ----------
  function renderCover() {
    var toc = PRODUCTS.map(function (p, i) {
      return '<button class="toc-item" data-go="' + (i + 1) + '">' +
        '<span class="toc-num">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="toc-name">' + esc(p.name) + '</span>' +
        '<span class="toc-w">' + esc(p.totalPower) + '</span></button>';
    }).join('');

    return '<div class="cover">' +
      '<div class="cover-hero-wrap"><img class="cover-hero" src="' + SITE.hero + '" alt=""></div>' +
      '<div class="cover-body">' +
        '<img class="cover-logo" src="' + SITE.logo + '" alt="' + esc(SITE.brand) + '">' +
        '<div class="cover-eyebrow">B2B Product Catalog</div>' +
        '<h1 class="cover-title">Professional Power &amp; <em>Fast-Charging</em> Solutions</h1>' +
        '<div class="cover-sub">' + esc(SITE.coverSub) + '</div>' +
        '<div class="cover-divider"></div>' +
        '<div class="cover-tagline">' + esc(SITE.tagline) + '</div>' +
        '<div class="cover-cta">' +
          '<button class="cover-btn" data-go="1">Browse Products</button>' +
          '<button class="cover-btn ghost" id="cover-scroll" data-scroll>Continuous Scroll</button>' +
        '</div>' +
        '<div class="toc">' + toc + '</div>' +
        '<div class="cover-company">' + esc(SITE.company) + '</div>' +
      '</div></div>';
  }

  function renderProduct(p, idx) {
    var badges = '<span class="badge power">' + esc(p.powerMax || p.totalPower) + '</span>';
    if (p.model) badges += '<span class="badge model">Model ' + esc(p.model) + '</span>';
    badges += '<span class="badge">' + esc(p.interface) + '</span>';

    var mainImg = p.images[0];
    var altImgs = p.images.slice(1);

    var sceneCol = '<span class="cap">Application</span><img src="' + p.scene + '" alt="' + esc(p.name) + ' scenario">';
    if (altImgs.length) {
      altImgs.forEach(function (im) {
        sceneCol += '<span class="cap">More view</span><img src="' + im + '" alt="' + esc(p.name) + '">';
      });
    }

    var keyGrid =
      '<div class="key-cell"><div class="k">Total Power</div><div class="v">' + esc(p.totalPower) + '</div></div>' +
      '<div class="key-cell"><div class="k">Input</div><div class="v">' + esc(p.input) + '</div></div>' +
      '<div class="key-cell"><div class="k">Interface</div><div class="v">' + esc(p.interface) + '</div></div>' +
      '<div class="key-cell"><div class="k">Ports</div><div class="v">' + p.ports + ' (' + p.usbC + ' USB-C)</div></div>';

    var protos = '';
    if (p.protocols && p.protocols.length) {
      protos = '<div class="protos"><div class="h4">Protocols</div><div class="chips">' +
        p.protocols.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') +
        '</div></div>';
    }

    var specs = '<div class="specs"><div class="h4">Full Specifications</div><ul class="spec-list">' +
      p.specs.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ul></div>';

    var inquiry = '<a class="inq-btn" href="' + inquiryHref(p) + '">Inquiry</a>' +
      '<a class="inq-btn alt" href="mailto:' + EMAIL + '">Contact Us</a>';

    return '<div class="ppage">' +
      '<div class="ppage-head">' +
        '<div class="ppage-title">' + esc(p.name) + '</div>' +
        '<div class="ppage-badges">' + badges + '</div>' +
      '</div>' +
      '<div class="ppage-body">' +
        '<div class="ppage-media">' +
          '<div class="ppage-photo"><img src="' + mainImg + '" alt="' + esc(p.name) + '"></div>' +
          '<div class="ppage-scene">' + sceneCol + '</div>' +
        '</div>' +
        '<div class="key-grid">' + keyGrid + '</div>' +
        protos +
        specs +
        '<div class="scenario"><span class="ic">&#9656;</span><p>' + esc(p.scenario) + '</p></div>' +
        '<div class="inquiry">' + inquiry + '</div>' +
      '</div>' +
    '</div>';
  }

  function renderThanks() {
    return '<div class="thanks">' +
      '<h2>Thank You</h2>' +
      '<div class="divider"></div>' +
      '<div class="co">' + esc(SITE.company) + '</div>' +
      '<div class="tg">' + esc(SITE.tagline) + '</div>' +
      '<div class="ct">' +
        '<a href="mailto:' + EMAIL + '">' + esc(EMAIL) + '</a>' +
        '<a href="http://www.goodwinpower.com" target="_blank" rel="noopener">' + esc(SITE.website) + '</a>' +
      '</div>' +
    '</div>';
  }

  function renderPage(i) {
    if (i < 0 || i >= PAGE_COUNT) return '';
    if (i === 0) return renderCover();
    if (i === PAGE_COUNT - 1) return renderThanks();
    return renderProduct(PRODUCTS[i - 1], i - 1);
  }

  function inquiryHref(p) {
    var label = p.name + (p.model ? ' (' + p.model + ')' : '');
    var subject = 'Inquiry: ' + label;
    var body = 'Hello Peterpower team,\n\nI am interested in the ' + label +
      ' (' + p.totalPower + '). Please send me more details, pricing and MOQ.\n\nThank you.';
    return 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
  }

  function renderInto(el, i) { el.innerHTML = renderPage(i); }

  // ---------- spread / layout ----------
  function layout(screen) {
    var w = pageW();
    var h = pageH();
    var dbl = screen.length > 1;
    stage.classList.toggle('stage--single', !dbl);
    stage.style.width = (dbl ? 2 * w : w) + 'px';
    stage.style.height = h + 'px';
    pageLeft.style.display = dbl ? 'block' : 'none';
    pageLeft.style.left = '0px';
    pageRight.style.left = (dbl ? w : 0) + 'px';
  }

  function renderSpread() {
    var screen = buildScreens()[screenOf(current)];
    if (screen.length > 1) {
      renderInto(pageLeft, screen[0]);
      renderInto(pageRight, screen[1]);
    } else {
      renderInto(pageRight, screen[0]);
      renderInto(pageLeft, -1);
    }
    layout(screen);
    updateChrome();
  }

  function updateChrome() {
    if (activeBook === 'full') {
      var st = pdfReady ? pdfReady.state() : { page: 0, count: 0 };
      pageInput.value = st.page || 1;
      pageInput.max = st.count || 1;
      pageTotal.textContent = '/ ' + (st.count || 0);
      mPage.textContent = (st.page || 0) + ' / ' + (st.count || 0);
      return;
    }

    var screen = buildScreens()[screenOf(current)];
    pageInput.value = screen[0] + 1;
    pageInput.max = PAGE_COUNT;
    pageTotal.textContent = '/ ' + PAGE_COUNT;
    mPage.textContent = (screen.length > 1
      ? (screen[0] + 1) + '-' + (screen[1] + 1)
      : String(screen[0] + 1)) + ' / ' + PAGE_COUNT;
    var thumbs = thumbGrid.querySelectorAll('.thumb');
    for (var i = 0; i < thumbs.length; i++) {
      thumbs[i].classList.toggle('active', screen.indexOf(Number(thumbs[i].dataset.go)) !== -1);
    }
  }

  // ---------- flip animation ----------
  function turn(dir) {
    if (flipping) return;
    var sc = buildScreens();
    var si = screenOf(current);
    var ni = si + dir;
    if (ni < 0 || ni >= sc.length) return;

    var from = sc[si], to = sc[ni];

    // The 3D page-flip only reads correctly between two real spreads; the
    // standalone cover / back cover simply swap in.
    if (from.length > 1 && to.length > 1) {
      var w = pageW();
      renderInto(pageLeft, to[0]);
      renderInto(pageRight, to[1]);
      flipper.style.display = 'block';
      flipper.style.left = (dir > 0 ? w : 0) + 'px';
      flipper.style.width = w + 'px';
      flipFront.innerHTML = renderPage(dir > 0 ? from[1] : from[0]);
      flipBack.innerHTML = renderPage(dir > 0 ? to[0] : to[1]);

      flipper.classList.remove('flip-forward', 'flip-backward', 'animating');
      void flipper.offsetWidth; // reflow to restart transition
      flipper.classList.add(dir > 0 ? 'flip-forward' : 'flip-backward', 'animating');
      flipping = true;

      var done = false;
      function complete() {
        if (done) return;
        done = true;
        flipper.removeEventListener('transitionend', complete);
        clearTimeout(timer);
        flipper.classList.remove('animating', 'flip-forward', 'flip-backward');
        flipper.style.display = 'none';
        current = to[0];
        renderSpread();
        flipping = false;
      }
      flipper.addEventListener('transitionend', complete);
      var timer = setTimeout(complete, 700);
      return;
    }

    current = to[0];
    renderSpread();
  }

  // ---------- navigation ----------
  function goToPage(i, animate) {
    if (i < 0 || i >= PAGE_COUNT) i = Math.max(0, Math.min(PAGE_COUNT - 1, i));
    if (mode === 'flip') {
      if (i === current) return;
      var si = screenOf(current), ni = screenOf(i);
      if (animate && Math.abs(ni - si) === 1 && !flipping) {
        turn(ni > si ? 1 : -1);
      } else {
        current = i;
        renderSpread();
      }
    } else {
      scrollToPage(i);
    }
  }

  function scrollToPage(i) {
    var pages = scroll.children;
    if (pages[i]) pages[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
    current = i;
    updateChrome();
  }

  // ---------- modes ----------
  function setMode(m) {
    mode = m;
    $('mode-label').textContent = m === 'flip' ? 'Scroll' : 'Flip';
    $('mode-ico').textContent = m === 'flip' ? '≡' : '▤';
    applyView();
  }

  // Only the active edition gets rebuilt; the other one is simply hidden.
  function applyView() {
    var full = activeBook === 'full';
    book.hidden = full || mode !== 'flip';
    scroll.hidden = full || mode !== 'scroll';
    pdfHost.hidden = !full;

    if (full) {
      if (pdfReady) {
        if (pdfReady.currentMode() !== pdfMode()) pdfReady.setView(pdfMode());
        else pdfReady.relayout(); // the shell may have been resized while hidden
      }
      updateChrome();
      return;
    }

    if (mode === 'flip') {
      renderSpread();
    } else {
      buildScroll();
      if (scroll.children[current]) scroll.children[current].scrollIntoView();
      updateChrome();
    }
  }

  // The PDF book has three layouts; the toolbar only exposes two, so the
  // narrow-viewport case picks its own single-page layout.
  function pdfMode() {
    if (mode === 'scroll') return 'scroll';
    return isSingle() ? 'single' : 'spread';
  }

  // ---------- edition switching ----------
  function switchBook(name) {
    if (name !== 'interactive' && name !== 'full') return;
    if (name === activeBook) return;
    activeBook = name;
    var full = name === 'full';

    var btns = bookSwitch.querySelectorAll('.bs-btn');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].dataset.book === name;
      btns[i].classList.toggle('active', on);
      btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    $('btn-search').hidden = full;
    $('btn-thumbs').hidden = full;

    applyView();
    if (full) ensurePdf();
    if (window.history && history.replaceState) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function ensurePdf() {
    if (pdfApi) return;
    // resolved against this script's own URL (assets/js/), so the sibling path
    pdfApi = import('./pdfbook.js').then(function (mod) {
      return mod.mount({ host: pdfHost, stage: pdfStage, onState: updateChrome });
    }).then(function (api) {
      pdfReady = api;
      if (api.currentMode() !== pdfMode()) api.setView(pdfMode());
      if (pendingPdfPage) {
        api.goTo(pendingPdfPage);
        pendingPdfPage = 0;
      }
      updateChrome();
    }).catch(function (err) { pdfFailed(err); });
  }

  function pdfFailed(err) {
    pdfReady = {
      state: function () { return { page: 0, count: 0 }; },
      turn: noop, goTo: noop, setView: noop, relayout: noop,
      currentMode: function () { return 'spread'; }
    };
    $('btn-mode').hidden = true;
    pager.hidden = true;

    var reason = err && err.reason;
    var body;
    if (reason === 'document') {
      body = '<p>The catalog file could not be opened. Reload the page and try again. If it keeps ' +
        'failing, tell your webmaster that <code>assets/catalog</code> did not load.</p>';
    } else if (reason === 'engine' || location.protocol === 'file:') {
      body = '<p>The 57-page catalog is drawn by a copy of PDF.js that ships inside this site. ' +
        'Browsers refuse to run that engine when a page is opened straight from a folder, so ' +
        'this edition cannot start here.</p>' +
        '<p>Open the catalog through its web address instead and the book loads normally. ' +
        'The 16-page interactive catalog works either way.</p>';
    } else {
      body = '<p>The viewer could not start. Reload the page and try again. If it keeps failing, ' +
        'tell your webmaster that <code>vendor/pdfjs</code> did not load.</p>';
    }
    pdfNotice.innerHTML = '<div class="pdf-notice-card"><h2>Full catalog is unavailable</h2>' + body + '</div>';
    pdfNotice.hidden = false;
    if (window.console && console.warn) console.warn('[full catalog]', err);
    updateChrome();
  }

  function noop() {}

  // ---------- input routing (works for whichever edition is open) ----------
  function pdfDo(fn) {
    if (pdfReady) fn(pdfReady);
    updateChrome();
  }

  function viewerTurn(dir) {
    if (activeBook === 'full') { pdfDo(function (a) { a.turn(dir); }); return; }
    if (mode === 'flip') turn(dir); else goToPage(current + dir);
  }

  function viewerGoPage(n) {
    if (activeBook === 'full') { pdfDo(function (a) { a.goTo(n); }); return; }
    goToPage(n - 1);
  }

  function viewerEdge(which) {
    if (activeBook === 'full') {
      pdfDo(function (a) { a.goTo(which === 'first' ? 1 : a.state().count); });
      return;
    }
    goToPage(which === 'first' ? 0 : PAGE_COUNT - 1);
  }

  function buildScroll() {
    var html = '';
    for (var i = 0; i < PAGE_COUNT; i++) {
      html += '<div class="page page--only" data-idx="' + i + '">' + renderPage(i) + '</div>';
    }
    scroll.innerHTML = html;
    scroll.addEventListener('scroll', onScroll, { passive: true });
  }

  function onScroll() {
    // find nearest page to top for page indicator
    var pages = scroll.children;
    var best = 0, bestDist = Infinity, top = scroll.scrollTop + 40;
    for (var i = 0; i < pages.length; i++) {
      var r = pages[i].getBoundingClientRect();
      var dist = Math.abs((r.top - scroll.getBoundingClientRect().top) - 40);
      // simpler: use offsetTop
      var ot = pages[i].offsetTop;
      if (Math.abs(ot - scroll.scrollTop) < bestDist) { bestDist = Math.abs(ot - scroll.scrollTop); best = i; }
    }
    if (best !== current) { current = best; updateChrome(); }
  }

  // ---------- thumbnails ----------
  function buildThumbs() {
    var html = '';
    for (var i = 0; i < PAGE_COUNT; i++) {
      var label, img;
      if (i === 0) { label = 'Cover'; img = SITE.hero; }
      else if (i === PAGE_COUNT - 1) { label = 'Thank You'; img = null; }
      else { label = PRODUCTS[i - 1].name; img = PRODUCTS[i - 1].images[0]; }
      var media = img ? '<img src="' + img + '" alt="" loading="lazy">' : '<div style="aspect-ratio:3/4;background:radial-gradient(120% 90% at 50% 0%,#3a2717,#17120e)"></div>';
      html += '<button class="thumb" data-go="' + i + '">' + media +
        '<div class="tl"><b>' + String(i + 1).padStart(2, '0') + '</b> ' + esc(label) + '</div></button>';
    }
    thumbGrid.innerHTML = html;
  }

  // ---------- search & filter ----------
  function runSearch() {
    var q = searchInput.value.trim().toLowerCase();
    var power = fPower.value, ports = fPorts.value, usbc = fUsbc.value, cat = fCat.value;

    var results = PRODUCTS.filter(function (p, idx) {
      var hay = (p.name + ' ' + (p.model || '') + ' ' + p.totalPower + ' ' + p.powerW + ' ' + p.interface + ' ' + p.category).toLowerCase();
      if (q && hay.indexOf(q) === -1) return false;
      if (power) {
        var r = power.split('-');
        var lo = parseInt(r[0], 10), hi = r[1] ? parseInt(r[1], 10) : Infinity;
        if (!(p.powerW >= lo && p.powerW <= hi)) return false;
      }
      if (ports && p.ports !== parseInt(ports, 10)) return false;
      if (usbc && p.usbC !== parseInt(usbc, 10)) return false;
      if (cat && p.category !== cat) return false;
      return true;
    });

    renderResults(results);
  }

  function renderResults(results) {
    if (!results.length) {
      searchResults.innerHTML = '<div class="none">No products match your criteria.</div>';
      return;
    }
    searchResults.innerHTML = results.map(function (p) {
      var idx = PRODUCTS.indexOf(p) + 1; // page index = product index + 1
      return '<button class="result" data-go="' + idx + '">' +
        '<img src="' + p.images[0] + '" alt="">' +
        '<span><span class="r-name">' + esc(p.name) + '</span>' +
        '<span class="r-sub">' + esc(p.totalPower) + ' · ' + esc(p.interface) + (p.model ? ' · ' + esc(p.model) : '') + '</span></span>' +
        '</button>';
    }).join('');
  }

  // ---------- drawers ----------
  function openDrawer(which) {
    if (which === 'thumbs') { thumbDrawer.classList.add('open'); searchPanel.classList.remove('open'); }
    else { searchPanel.classList.add('open'); thumbDrawer.classList.remove('open'); }
    overlay.hidden = false;
  }
  function closeDrawers() {
    thumbDrawer.classList.remove('open');
    searchPanel.classList.remove('open');
    overlay.hidden = true;
  }

  // ---------- events ----------
  function bind() {
    $('btn-next').addEventListener('click', function () { viewerTurn(1); });
    $('btn-prev').addEventListener('click', function () { viewerTurn(-1); });
    $('m-next').addEventListener('click', function () { viewerTurn(1); });
    $('m-prev').addEventListener('click', function () { viewerTurn(-1); });

    $('btn-mode').addEventListener('click', function () { setMode(mode === 'flip' ? 'scroll' : 'flip'); });

    bookSwitch.addEventListener('click', function (e) {
      var b = e.target.closest('.bs-btn');
      if (b) switchBook(b.dataset.book);
    });

    $('btn-thumbs').addEventListener('click', function () { openDrawer('thumbs'); });
    $('btn-search').addEventListener('click', function () { openDrawer('search'); searchInput.focus(); });
    $('btn-close-thumbs').addEventListener('click', closeDrawers);
    $('btn-close-search').addEventListener('click', closeDrawers);
    overlay.addEventListener('click', closeDrawers);

    $('btn-fullscreen').addEventListener('click', function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    });

    pageInput.addEventListener('change', function () {
      var n = parseInt(pageInput.value, 10);
      if (!isNaN(n)) viewerGoPage(n);
    });

    // delegated clicks for data-go / data-scroll
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-go]');
      if (t) { goToPage(Number(t.dataset.go)); closeDrawers(); return; }
      if (e.target.closest('#cover-scroll')) { setMode('scroll'); }
    });

    // search
    searchInput.addEventListener('input', runSearch);
    [fPower, fPorts, fUsbc, fCat].forEach(function (el) { el.addEventListener('change', runSearch); });
    $('btn-clear').addEventListener('click', function () {
      searchInput.value = ''; fPower.value = ''; fPorts.value = ''; fUsbc.value = ''; fCat.value = '';
      runSearch();
    });

    // keyboard
    document.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': viewerTurn(1); break;
        case 'ArrowLeft': case 'PageUp': viewerTurn(-1); break;
        case 'Home': viewerEdge('first'); break;
        case 'End': viewerEdge('last'); break;
      }
    });

    // mouse wheel in flip mode
    var wheelLock = 0;
    document.addEventListener('wheel', function (e) {
      if (mode !== 'flip') return;
      var now = Date.now();
      if (now - wheelLock < 700) return;
      wheelLock = now;
      if (e.deltaY > 0) viewerTurn(1); else viewerTurn(-1);
    }, { passive: true });

    // touch swipe in flip mode
    var tx = 0, ty = 0;
    document.addEventListener('touchstart', function (e) {
      tx = e.touches[0].clientX; ty = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (mode !== 'flip') return;
      var dx = e.changedTouches[0].clientX - tx;
      var dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        viewerTurn(dx < 0 ? 1 : -1);
      }
    }, { passive: true });

    // resize (the PDF edition owns its own resize handling)
    window.addEventListener('resize', function () {
      if (activeBook === 'interactive' && mode === 'flip') renderSpread();
    });

    // read-only hardening
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('dragstart', function (e) { if (e.target.tagName === 'IMG') e.preventDefault(); });
  }

  // ---------- init ----------
  function init() {
    // footer contact
    $('foot-company').textContent = SITE.company;
    $('foot-mail').querySelector('span').textContent = EMAIL;
    $('foot-mail').href = 'mailto:' + EMAIL;
    $('foot-web').querySelector('span').textContent = SITE.website;
    $('foot-web').href = 'http://www.goodwinpower.com';

    pageInput.max = PAGE_COUNT;
    pageTotal.textContent = '/ ' + PAGE_COUNT;

    buildThumbs();
    bind();

    // mobile defaults to scroll mode
    var startMode = isSingle() ? 'scroll' : 'flip';
    setMode(startMode);

    // deep links: #3 opens page 3 of Catalog 2026, #full / #full12 opens the
    // 57-page edition (optionally at page 12)
    var full = /^#full(\d*)$/.exec(location.hash);
    if (full) {
      pendingPdfPage = full[1] ? parseInt(full[1], 10) : 0;
      switchBook('full');
      if (pdfReady && pendingPdfPage) { pdfReady.goTo(pendingPdfPage); pendingPdfPage = 0; }
      return;
    }
    var h = parseInt(location.hash.slice(1), 10);
    if (!isNaN(h) && h >= 1 && h <= PAGE_COUNT) goToPage(h - 1);
  }

  init();
})();
