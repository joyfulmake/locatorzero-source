// LocatorZero web. Everything below runs in this tab. The page's CSP sets connect-src 'none', so no code here,
// including this file, can send a request anywhere. The index is a plain array in memory and is dropped on wipe.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var PREVIEW_MAX = 65536;            // bytes read from a file for a text preview (ADR-0023)
  var IMAGE_MAX = 10 * 1024 * 1024;   // images are shown whole, so they get their own, stated cap
  var IDLE_MS = 5 * 60 * 1000;
  var PAGE = 100;
  var MAP_LEAVES = 150;
  var ITEM_CAP = 500000;
  var SKIP_DIRS = { 'node_modules': 1, '__pycache__': 1, '.git': 1 };

  var KINDS = [
    ['all', 'All'], ['doc', 'Documents'], ['data', 'Sheets & data'], ['img', 'Images'], ['media', 'Audio & video'],
    ['code', 'Code'], ['arch', 'Archives'], ['web', 'Web pages'], ['folder', 'Folders'], ['other', 'Other']
  ];
  var AGES = [['any', 'Any time', 0], ['1d', '24 hours', 1], ['7d', '7 days', 7], ['30d', '30 days', 30], ['1y', '1 year', 365]];
  var EXT_KIND = {};
  [['doc', 'pdf doc docx md markdown txt rtf odt pages tex epub ppt pptx key odp'],
   ['data', 'xls xlsx csv tsv numbers ods json xml yaml yml toml sqlite db parquet'],
   ['img', 'png jpg jpeg gif webp svg heic heif bmp tif tiff ico avif raw psd'],
   ['media', 'mp4 mov mkv avi webm mp3 wav m4a flac ogg aac'],
   ['code', 'js mjs cjs ts tsx jsx py rs go java kt swift c h cpp hpp cs rb php html htm css scss sh bash zsh ps1 lua sql vue svelte'],
   ['arch', 'zip gz tgz tar 7z rar bz2 xz dmg iso']]
    .forEach(function (row) { row[1].split(' ').forEach(function (e) { EXT_KIND[e] = row[0]; }); });
  var TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|toml|ini|cfg|conf|log|js|mjs|cjs|ts|tsx|jsx|py|rs|go|java|kt|swift|c|h|cpp|hpp|cs|rb|php|html?|css|scss|sh|bash|zsh|ps1|lua|sql|vue|svelte|env|gitignore|dockerfile|makefile|rtf|tex|srt|vtt)$/i;
  var KIND_LABEL = { doc: 'DOC', data: 'DATA', img: 'IMG', media: 'AV', code: 'CODE', arch: 'ZIP', web: 'WEB', proc: 'PROC', folder: 'DIR', other: 'FILE' };

  var state = {
    demo: true,
    folders: [],
    includeHidden: false,
    kind: 'all',
    age: 'any',
    q: '',
    results: [],
    shown: 0,
    sel: -1,
    tab: 'list',
    recent: [],
    reads: 0,
    readBytes: 0,
    blocked: 0,
    netStatus: 'checking',
    lastActive: Date.now(),
    openItem: null,
    objectUrl: null
  };
  var nextFolderId = 1;
  state.mapToggle = {};

  // Desktop only: native.js provides LZ_NATIVE, backed by the Rust core's read-only commands.
  var NATIVE = window.LZ_NATIVE || null;
  state.native = { files: true, tabs: true, history: true, proc: true };
  state.nativeHits = [];
  state.nativeQ = null;
  state.nativeSeq = 0;
  state.nativeStatus = null;
  // Where to search. Web: all (demo + added folders), demo, or one added folder. Desktop: everywhere, or one place.
  state.scope = { type: NATIVE ? 'everywhere' : 'all' };
  state.sessionPlaces = [];   // desktop places chosen this session (drives, folders); forgotten on wipe
  state.consented = {};       // consent given this session, by key

  // ---------- small helpers ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nf(n) { return n.toLocaleString(); }
  function fmtSize(b) {
    if (b == null) return '–';
    if (b < 1024) return b + ' B';
    var u = ['KB', 'MB', 'GB', 'TB'], i = -1;
    do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
    return (b < 10 ? b.toFixed(1) : Math.round(b)) + ' ' + u[i];
  }
  var rtf = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;
  function fmtAgo(t) {
    if (!t) return '–';
    var s = (t - Date.now()) / 1000, a = Math.abs(s);
    if (!rtf) return new Date(t).toLocaleDateString();
    if (a < 60) return rtf.format(Math.round(s), 'second');
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
    if (a < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), 'month');
    return rtf.format(Math.round(s / (86400 * 365)), 'year');
  }
  function fmtDate(t) { return t ? new Date(t).toLocaleString() : '–'; }
  function extOf(name) { var m = /\.([^./]+)$/.exec(name); return m ? m[1].toLowerCase() : ''; }
  function kindOf(name) { return EXT_KIND[extOf(name)] || 'other'; }
  function kindColor(k) { return 'var(--k-' + kindKey(k) + ')'; }
  function kindKey(k) { return KIND_LABEL[k] ? k : 'other'; }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function prep(it) { it.ln = it.n.toLowerCase(); it.lp = it.p.toLowerCase(); return it; }

  if (window.LZ_DEMO) window.LZ_DEMO.items.forEach(prep);

  // ---------- search ----------
  function tokens(q) { return q.toLowerCase().split(/\s+/).filter(Boolean); }

  function search() {
    var t0 = performance.now();
    var q = state.q.trim(), toks = tokens(q), ql = q.toLowerCase();
    var out = [];
    if (toks.length) {
      var ageDays = AGES.filter(function (a) { return a[0] === state.age; })[0][2];
      var minT = ageDays ? Date.now() - ageDays * 864e5 : 0;
      var now = Date.now();
      var lists = [];
      var sc = state.scope;
      if (sc.type === 'folder' && !state.folders.some(function (f) { return f.id === sc.id; })) sc = state.scope = { type: 'all' };
      if (sc.type === 'all' || sc.type === 'everywhere') {
        if (state.demo && window.LZ_DEMO) lists.push(window.LZ_DEMO.items);
        state.folders.forEach(function (f) { lists.push(f.items); });
        if (NATIVE) lists.push(state.nativeHits.filter(function (h) { return state.native[h.s]; }));
      } else if (sc.type === 'demo' && window.LZ_DEMO) {
        lists.push(window.LZ_DEMO.items);
      } else if (sc.type === 'folder') {
        state.folders.forEach(function (f) { if (f.id === sc.id) lists.push(f.items); });
      } else if (sc.type === 'place') {
        lists.push(state.nativeHits);
      }
      for (var L = 0; L < lists.length; L++) {
        var arr = lists[L];
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i];
          if (state.kind !== 'all' && it.k !== state.kind) continue;
          if (minT && (!it.t || it.t < minT)) continue;
          var lp = it.lp, ok = true, inName = true;
          for (var j = 0; j < toks.length; j++) {
            if (lp.indexOf(toks[j]) < 0) { ok = false; break; }
            if (inName && it.ln.indexOf(toks[j]) < 0) inName = false;
          }
          if (!ok) continue;
          var ln = it.ln, sc;
          if (ln === ql) sc = 1000;
          else if (ln.lastIndexOf(ql, 0) === 0) sc = 600;
          else if (ln.indexOf(ql) >= 0) sc = 420;
          else if (inName) sc = 260;
          else sc = 100;
          if (it.t) sc += 60 * Math.exp(-(now - it.t) / (864e5 * 120));
          if (it.native && it.s === 'files') {
            // Whole-disk results: dot-folders (caches, toolchains) and deep paths are rarely what someone means.
            if (/[\/\\]\.[^\/\\]/.test(it.p)) sc -= 180;
            sc -= Math.min(60, (it.p.match(/[\/\\]/g) || []).length * 4);
            if (it.k !== 'folder') sc += 20;
          }
          out.push({ it: it, sc: sc });
        }
      }
      out.sort(function (a, b) { return b.sc - a.sc || a.it.n.length - b.it.n.length; });
    }
    state.results = out.map(function (o) { return o.it; });
    state.ms = performance.now() - t0;
    state.searched = state.q;
    if (NATIVE) requestNative(q);
    state.shown = Math.min(PAGE, state.results.length);
    state.sel = state.results.length ? 0 : -1;
    render();
  }

  // Ask the desktop core. Earlier native hits stay on screen, filtered by the new query, until the answer lands.
  function nativeScope() { return state.scope.type === 'place' ? { path: state.scope.place.path, indexed: state.scope.place.indexed } : null; }
  function requestNative(q) {
    var key = q + '\u0000' + (state.scope.type === 'place' ? state.scope.place.path : '*');
    if (key === state.nativeQ || key === state.nativePending) return;
    if (q && state.scope.type === 'everywhere' && !hasConsent('everywhere')) {
      state.nativeHits = [];
      if (!state.askedEverywhere) { state.askedEverywhere = true; askEverywhere(); }
      return;
    }
    state.nativePending = key;
    q = key.split('\u0000')[0];
    clearTimeout(requestNative.timer);
    requestNative.timer = setTimeout(function () {
      var seq = ++state.nativeSeq;
      if (!q) { state.nativeHits = []; state.nativeQ = key; state.nativePending = null; return; }
      var srcs = Object.keys(state.native).filter(function (k) { return state.native[k]; });
      NATIVE.locate(q, srcs, nativeScope()).then(function (out) {
        if (seq !== state.nativeSeq) return;
        if (out.licence_required) {
          state.nativeHits = []; state.nativeQ = key; state.nativePending = null;
          refreshLicence(); openPlans('ended');
          return search();
        }
        state.nativeHits = out.hits.map(function (h) {
          h.native = true;
          if (!h.k) h.k = kindOf(h.n);
          if (h.url && h.n === h.url) h.n = bareUrl(h.url);
          return prep(h);
        });
        state.nativeQ = key; state.nativePending = null; state.nativeMs = out.ms;
        if (out.errors.length) console.warn('LocatorZero sources:', out.errors.join('; '));
        search();
      }, function (e) {
        if (seq !== state.nativeSeq) return;
        state.nativePending = null; toast('Searching this computer failed: ' + e);
      });
    }, 60);
  }
  function refreshNative() { state.nativeQ = null; state.nativePending = null; scheduleSearch(); }

  var queued = false;
  function scheduleSearch() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; search(); });
  }

  // ---------- rendering ----------
  function highlight(text, toks) {
    if (!toks.length) return esc(text);
    var lower = text.toLowerCase(), ranges = [];
    toks.forEach(function (t) {
      var from = 0, i;
      while ((i = lower.indexOf(t, from)) >= 0) { ranges.push([i, i + t.length]); from = i + t.length; }
    });
    if (!ranges.length) return esc(text);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [ranges[0]];
    for (var k = 1; k < ranges.length; k++) {
      var last = merged[merged.length - 1];
      if (ranges[k][0] <= last[1]) last[1] = Math.max(last[1], ranges[k][1]); else merged.push(ranges[k]);
    }
    var html = '', pos = 0;
    merged.forEach(function (r) { html += esc(text.slice(pos, r[0])) + '<mark>' + esc(text.slice(r[0], r[1])) + '</mark>'; pos = r[1]; });
    return html + esc(text.slice(pos));
  }

  function dirOf(p) { var i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : ''; }
  function canPreview(it) { return it.k !== 'folder' && (it.demo || it.h || it.file || (it.native && it.s === 'files')); }
  function lastSeg(p) { var m = /[^\/\\]*$/.exec(p); return m ? m[0] : p; }
  // Addresses are shown without ?query and #fragment, which is where sign-in tokens and session ids live.
  // Copy and Open still use the full address.
  function bareUrl(u) { return u.replace(/[?#].*$/, ''); }
  function whereLine(it) { return it.url ? bareUrl(it.url) : (lastSeg(it.p) === it.n ? dirOf(it.p) : it.p); }

  function rowHtml(it, idx, toks) {
    var k = it.k;
    return '<li class="r" role="option" id="r' + idx + '" data-i="' + idx + '" aria-selected="' + (idx === state.sel) + '">' +
      '<div class="r-ico k-' + kindKey(k) + '">' + (k === 'other' ? esc(extOf(it.n).slice(0, 4) || 'file') : KIND_LABEL[k]) + '</div>' +
      '<div class="r-main">' +
        '<div class="r-name">' + highlight(it.n, toks) + '</div>' +
        '<div class="r-path"><bdi>' + highlight(whereLine(it), toks) + '</bdi></div>' +
        '<div class="r-meta"><span class="src-badge">' + esc(it.src) + (it.demo ? ' · demo' : '') + '</span>' +
          (it.z ? '<span>' + fmtSize(it.z) + '</span>' : '') +
          (it.t ? '<span title="' + esc(fmtDate(it.t)) + '">' + fmtAgo(it.t) + '</span>' : '') + '</div>' +
      '</div>' +
      '<div class="r-act">' +
        (canPreview(it) ? '<button class="btn btn-soft" data-act="preview">Preview</button>' : '') +
        (it.native && it.s === 'files' ? '<button class="btn btn-ghost" data-act="reveal">Show in folder</button>' : '') +
        (it.url ? '<button class="btn btn-ghost" data-act="open">Open</button>' : '') +
        '<button class="btn btn-ghost" data-act="copy" aria-label="Copy ' + (it.url ? 'address' : 'path') + '">Copy</button>' +
      '</div></li>';
  }

  // A picked folder is a snapshot. Files deleted since then are dropped: the visible ones are checked through their
  // handles (a metadata lookup, no content read), and any that fail a preview are dropped on the spot.
  var verifying = false;
  function dropItem(it) {
    state.folders.forEach(function (f) { var i = f.items.indexOf(it); if (i >= 0) f.items.splice(i, 1); });
  }
  function verifyVisible() {
    if (verifying) return;
    var todo = state.results.slice(0, state.shown).filter(function (it) { return it.h && !it.checked; });
    if (!todo.length) return;
    verifying = true;
    Promise.all(todo.map(function (it) {
      return it.h.getFile().then(function () { it.checked = true; return false; }, function (e) {
        if (e && e.name === 'NotFoundError') { dropItem(it); return true; }
        it.checked = true; return false;
      });
    })).then(function (gone) {
      verifying = false;
      if (gone.some(Boolean)) search();
    });
  }

  function renderList() {
    var toks = tokens(state.q), html = '';
    for (var i = 0; i < state.shown; i++) html += rowHtml(state.results[i], i, toks);
    $('results').innerHTML = html;
    $('moreBtn').hidden = state.shown >= state.results.length;
    verifyVisible();
    if (!$('moreBtn').hidden) $('moreBtn').textContent = 'Show ' + nf(Math.min(PAGE, state.results.length - state.shown)) + ' more';
  }

  function render() {
    var has = state.q.trim().length > 0;
    document.body.classList.toggle('has-query', has);
    $('resultsWrap').hidden = !has;
    renderScope();
    if (!has) { $('q').removeAttribute('aria-activedescendant'); return; }
    var n = state.results.length;
    var looking = !!(NATIVE && state.nativePending);
    var ms = NATIVE && state.nativeMs != null && state.scope.type !== 'demo' && state.scope.type !== 'folder'
      ? Math.round(state.nativeMs + state.ms) + ' ms' : (state.ms < 1 ? state.ms.toFixed(2) : state.ms.toFixed(1)) + ' ms';
    $('stat').className = 'stat ' + (looking ? 'is-busy' : n ? 'is-done' : 'is-none');
    $('stat').innerHTML = looking
      ? '<i class="busy-dot"></i>Searching ' + esc($('scopeLabel').textContent.toLowerCase()) + '…' + (n ? ' <b>' + nf(n) + '</b> so far' : '')
      : n ? '✓ Search complete · <b>' + nf(n) + '</b> location' + (n === 1 ? '' : 's') + ' · ' + ms
      : '✓ Search complete · no matches · ' + ms;
    var none = !n && !looking;
    if (none) renderEmpty(ms);
    $('empty').hidden = !none || state.tab !== 'list';
    // Tabs stay available with no results: the map then shows every place that was searched.
    document.querySelector('.tabs').hidden = looking && !n;
    $('panelList').hidden = state.tab !== 'list' || !n;
    $('panelMap').hidden = state.tab !== 'map' || !(n || none);
    if (state.tab === 'list') renderList(); else if (n) renderMap(); else if (none) renderCoverage();
    placeInk();
    updateActiveDescendant();
  }

  // No results: say so plainly, say where we looked, and offer the next step.
  function renderEmpty(ms) {
    var q = state.q.trim(), tips = [];
    var chip = function (t) { return '<button class="chip" data-try="' + esc(t) + '">' + esc(t) + '</button>'; };
    var words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1) tips.push('Every word must match. Try one word at a time: ' + words.slice(0, 4).map(chip).join(' '));
    else if (q.length > 2) tips.push('Try fewer letters: ' + chip(q.slice(0, -1)) + (q.length > 5 ? ' ' + chip(q.slice(0, Math.ceil(q.length / 2))) : ''));
    tips.push('Names don\'t need to be complete, but the letters must be in that order: <i>budg</i> finds <i>Budget_2026.xlsx</i>.');
    var filt = [];
    if (state.kind !== 'all') filt.push(KINDS.filter(function (k) { return k[0] === state.kind; })[0][1]);
    if (state.age !== 'any') filt.push('last ' + AGES.filter(function (a) { return a[0] === state.age; })[0][1]);
    if (filt.length) tips.push('Filters are on (' + esc(filt.join(', ')) + '). <button class="chip" data-clear-filters="1">Clear filters</button>');
    if (state.scope.type !== 'all' && state.scope.type !== 'everywhere') tips.push('You searched one place only. <button class="chip" data-scope="' + (NATIVE ? 'everywhere' : 'all') + '">Search everywhere</button>');
    tips.push('Look somewhere else: <button class="chip" data-open-scope="1">Search in…</button>' + (NATIVE ? '' : ' <button class="chip" data-choose="1">Choose a folder</button>'));
    $('empty').innerHTML = '<div class="empty-face" aria-hidden="true">🔍</div>' +
      '<h3>No matches for “' + esc(q) + '”</h3>' +
      '<p class="muted">The search finished in ' + esc(ms) + ' and looked in <b>' + esc($('scopeLabel').textContent) + '</b>. There is nothing by that name there.</p>' +
      '<ul class="empty-tips">' + tips.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>';
  }

  // The Search button and Enter: run now, show the outcome, and point at it.
  function runSearchNow() {
    var q = $('q').value.trim();
    if (!q) { $('q').focus(); toast('Type a few letters of a name first, for example “budg”.'); return; }
    state.q = $('q').value; refreshNative(); search();
    var st = $('stat'); st.classList.remove('flash'); void st.offsetWidth; st.classList.add('flash');
    if (!state.results.length && !state.nativePending) $('empty').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function renderScope() {
    renderScopeBtn();
    var sc = state.scope, all = ' · <button class="link-btn" data-scope="' + (NATIVE ? 'everywhere' : 'all') + '">Search everywhere</button>';
    if (sc.type === 'place') {
      var listing = !sc.place.indexed ? (state.placeDone ? ' (' + nf(state.placeCount || 0) + ' items listed in memory)' : ' · listing… ' + nf(state.placeCount || 0) + ' items so far') : '';
      $('scopeLine').innerHTML = 'Searching only in <b>' + esc(sc.place.label) + '</b> <span class="mono small">' + esc(sc.place.path) + '</span>' + listing + all;
      return;
    }
    if (sc.type === 'folder') {
      var f = state.folders.filter(function (x) { return x.id === sc.id; })[0];
      $('scopeLine').innerHTML = f ? 'Searching only in your folder <b>' + esc(f.name) + '</b> (' + nf(f.items.length) + (f.done ? '' : '… listing') + ')' + all : '';
      return;
    }
    if (sc.type === 'demo') { $('scopeLine').innerHTML = 'Searching only the <b>demo computer</b> (made-up items)' + all; return; }
    if (NATIVE && !hasConsent('everywhere')) {
      $('scopeLine').innerHTML = 'LocatorZero needs your OK before it searches this computer · <button class="link-btn" data-consent="everywhere">Review and allow</button>';
      return;
    }
    var parts = [];
    if (NATIVE) {
      if (state.native.files) parts.push('<b>this computer</b>');
      if (state.native.tabs && state.nativeStatus && /^live/.test((state.nativeStatus.sources.filter(function (x) { return x.id === 'tabs'; })[0] || {}).mode || '')) parts.push('<b>open tabs</b>');
      if (state.native.history) parts.push('<b>browser history</b>');
      if (state.native.proc) parts.push('<b>running apps</b>');
    }
    if (state.demo && window.LZ_DEMO) parts.push('<b>demo data</b> (' + nf(window.LZ_DEMO.items.length) + ' made-up items)');
    state.folders.forEach(function (f) {
      parts.push('<b>' + esc(f.name) + '</b> (' + nf(f.items.length) + (f.done ? '' : '… indexing') + ')');
    });
    var filt = [];
    if (state.kind !== 'all') filt.push(KINDS.filter(function (k) { return k[0] === state.kind; })[0][1]);
    if (state.age !== 'any') filt.push('last ' + AGES.filter(function (a) { return a[0] === state.age; })[0][1]);
    $('scopeLine').innerHTML = parts.length
      ? 'Searching ' + parts.join(' + ') + (filt.length ? ' · filtered to ' + esc(filt.join(', ')) : '')
      : 'No sources yet. Choose a folder, or turn demo data back on in the sidebar.';
  }

  function updateActiveDescendant() {
    if (state.sel >= 0 && state.tab === 'list') $('q').setAttribute('aria-activedescendant', 'r' + state.sel);
    else $('q').removeAttribute('aria-activedescendant');
  }

  function select(i, scroll) {
    if (i < 0 || i >= state.results.length) return;
    if (i >= state.shown) { state.shown = Math.min(state.results.length, i + PAGE); renderList(); }
    var prev = document.querySelector('.r[aria-selected="true"]');
    if (prev) prev.setAttribute('aria-selected', 'false');
    state.sel = i;
    var el = $('r' + i);
    if (el) { el.setAttribute('aria-selected', 'true'); if (scroll) el.scrollIntoView({ block: 'nearest' }); }
    updateActiveDescendant();
  }

  // ---------- map ----------
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, text) {
    var e = document.createElementNS(SVGNS, tag);
    for (var a in attrs) e.setAttribute(a, attrs[a]);
    if (text != null) e.textContent = text;
    return e;
  }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function buildTree(items) {
    var root = { label: '', kids: {}, order: [], leaves: 0 };
    items.forEach(function (it, idx) {
      var segs = it.p.split(/[\/\\]/).filter(Boolean), node = root;
      if (segs[segs.length - 1] === it.n) segs.pop();
      var lane = it.src;
      if (!node.kids[lane]) { node.kids[lane] = { label: lane, kids: {}, order: [], leaves: 0, lane: true }; node.order.push(lane); }
      node = node.kids[lane]; node.leaves++;
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (!node.kids[s]) { node.kids[s] = { label: s, kids: {}, order: [], leaves: 0 }; node.order.push(s); }
        node = node.kids[s]; node.leaves++;
      }
      var key = '\u0000' + idx;
      node.kids[key] = { label: it.n, kids: {}, order: [], leaves: 1, item: it, idx: idx };
      node.order.push(key);
    });
    // Fold chains of single-child folders into one node ("Users/alex/Documents") so the map stays readable.
    (function compress(n) {
      n.order.forEach(function (k) {
        var c = n.kids[k];
        while (!c.item && !c.lane && c.order.length === 1 && !c.kids[c.order[0]].item) {
          var only = c.kids[c.order[0]];
          c.label = c.label + '/' + only.label; c.kids = only.kids; c.order = only.order;
        }
        compress(c);
      });
    })(root);
    return root;
  }

  // The places the current search looked in, named the way result lanes are named.
  function searchedPlaces() {
    var sc = state.scope, out = [];
    if (sc.type === 'place') return [sc.place.label];
    if (sc.type === 'folder') {
      state.folders.forEach(function (f) { if (f.id === sc.id) out.push('Your folder · ' + f.name); });
      return out;
    }
    var all = sc.type === 'all' || sc.type === 'everywhere';
    if (NATIVE && all) {
      if (state.native.files) out.push('This computer');
      var tabs = state.nativeStatus && state.nativeStatus.sources.filter(function (x) { return x.id === 'tabs'; })[0];
      if (state.native.tabs && tabs && /^live/.test(tabs.mode)) out.push('Open tabs');
      if (state.native.history) out.push('Browser history');
      if (state.native.proc) out.push('Running processes');
    }
    if (window.LZ_DEMO && (sc.type === 'demo' || (all && state.demo))) {
      Object.keys(window.LZ_DEMO.sources).forEach(function (k) { out.push(window.LZ_DEMO.sources[k] + ' (demo)'); });
    }
    if (all) state.folders.forEach(function (f) { out.push('Your folder · ' + f.name); });
    return out;
  }

  // No matches: draw the search itself, fanning out to every place it checked, each marked "no match".
  function renderCoverage() {
    var svg = $('map');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var places = searchedPlaces(), q = state.q.trim();
    var cw = $('mapScroll').clientWidth, narrow = cw < 600;
    var ROW = narrow ? 54 : 46, PADY = 22, X0 = narrow ? 22 : 28, X1 = narrow ? 112 : 230, X2 = 520;
    var height = Math.max(places.length, 1) * ROW + PADY * 2, width = narrow ? Math.max(cw - 2, 300) : X2 + 260;
    svg.setAttribute('width', width); svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    var midY = height / 2, g = svgEl('g', {});
    svg.appendChild(g);
    places.forEach(function (label, i) {
      var y = PADY + i * ROW + ROW / 2;
      g.appendChild(svgEl('rect', { 'class': 'lane-bg', x: X1 - 16, y: y - ROW / 2 + 4, width: width - X1 + 8, height: ROW - 8, rx: 12 }));
      g.appendChild(svgEl('path', { 'class': 'edge', d: 'M' + (X0 + 10) + ',' + midY + ' C' + (X0 + X1) / 2 + ',' + midY + ' ' + (X0 + X1) / 2 + ',' + y + ' ' + (X1 - 8) + ',' + y }));
      g.appendChild(svgEl('circle', { 'class': 'lane-dot', cx: X1, cy: y, r: 7 }));
      if (narrow) {
        // Phones: the verdict sits under the place name, so nothing overlaps.
        g.appendChild(svgEl('text', { 'class': 'lane-label', x: X1 + 14, y: y - 3 }, trunc(label, Math.floor((width - X1 - 30) / 8))));
        g.appendChild(svgEl('text', { 'class': 'miss-text', x: X1 + 14, y: y + 14 }, '✕ no match'));
      } else {
        g.appendChild(svgEl('text', { 'class': 'lane-label', x: X1 + 14, y: y + 4 }, trunc(label, 30)));
        g.appendChild(svgEl('path', { 'class': 'edge miss', d: 'M' + (X2 - 70) + ',' + y + ' L' + (X2 - 10) + ',' + y }));
        g.appendChild(svgEl('circle', { 'class': 'miss-dot', cx: X2, cy: y, r: 7 }));
        g.appendChild(svgEl('text', { 'class': 'miss-text', x: X2 + 14, y: y + 4 }, 'no match'));
      }
    });
    var root = svgEl('g', { 'class': 'node' });
    root.appendChild(svgEl('circle', { 'class': 'query-dot', cx: X0, cy: midY, r: 10 }));
    root.appendChild(svgEl('text', { 'class': 'query-text', x: X0 - 6, y: midY - 18 }, '“' + trunc(q, narrow ? 14 : 24) + '”'));
    g.appendChild(root);
    $('mapNote').textContent = 'Searched ' + places.length + ' place' + (places.length === 1 ? '' : 's') + ' for “' + q +
      '”. None of them has a match. The Locations tab has suggestions for what to try next.';
  }

  function renderMap() {
    var svg = $('map');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var items = state.results.slice(0, MAP_LEAVES);
    var tree = buildTree(items);
    var narrow = $('mapScroll').clientWidth < 600;
    var ROW = 26, COL = narrow ? 118 : 200, PADX = narrow ? 18 : 24, PADY = 18, LANEGAP = 14, FOLDER_CH = narrow ? 14 : 26;
    var y = PADY, maxDepth = 0, lanes = [];

    // Folders start collapsed unless they hold one of the top results, so a whole-disk answer stays readable.
    // Small answers open fully. Clicks flip a folder until the query changes.
    if (state.mapQ !== state.q) { state.mapQ = state.q; state.mapToggle = {}; }
    var openAll = items.length <= 40;
    (function keys(n, key) {
      n.key = key; n.minIdx = n.item ? n.idx : Infinity;
      n.order.forEach(function (k) { var c = n.kids[k]; keys(c, key + '/' + c.label); if (c.minIdx < n.minIdx) n.minIdx = c.minIdx; });
    })(tree, '');
    function isOpen(n) {
      if (n.lane || n.depth < 0) return true;
      var t = state.mapToggle[n.key];
      return t !== undefined ? t : openAll || n.minIdx < 12;
    }

    (function layout(n, depth) {
      n.depth = depth; if (depth > maxDepth) maxDepth = depth;
      n.collapsed = false;
      if (n.item) { n.y = n.top = y; y += ROW; return; }
      if (!isOpen(n)) { n.collapsed = true; n.y = n.top = y; y += ROW; return; }
      if (n.lane) { if (narrow) y += 22; var start = y; } // on phones the lane title sits on its own line
      n.order.forEach(function (k) { layout(n.kids[k], depth + 1); });
      if (n.lane && y - start < 2 * ROW) y = start + 2 * ROW; // room for the lane title and its count
      var first = n.kids[n.order[0]], last = n.kids[n.order[n.order.length - 1]];
      n.top = n.order.length ? first.top : y;
      n.y = !n.order.length ? y : n.lane ? n.top : (first.y + last.y) / 2; // lane titles sit at the top so long lanes stay labelled
      if (n.lane) { lanes.push({ label: n.label, y0: start - (narrow ? 30 : 8), y1: y - ROW + 16, count: n.leaves }); y += LANEGAP; }
    })(tree, -1);

    var width = PADX * 2 + (maxDepth) * COL + (narrow ? 230 : 320);
    var height = y + PADY;
    svg.setAttribute('width', width); svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

    var gLanes = svgEl('g', {}), gEdges = svgEl('g', {}), gNodes = svgEl('g', {});
    svg.appendChild(gLanes); svg.appendChild(gEdges); svg.appendChild(gNodes);
    lanes.forEach(function (l) {
      gLanes.appendChild(svgEl('rect', { 'class': 'lane-bg', x: 8, y: l.y0, width: width - 16, height: l.y1 - l.y0, rx: 12 }));
    });

    function xOf(n) { return PADX + n.depth * COL; }
    (function draw(n) {
      if (!n.collapsed) n.order.forEach(function (k) {
        var c = n.kids[k];
        if (n.depth >= 0) {
          var x1 = xOf(n) + 6, y1 = n.y, x2 = xOf(c) - 6, y2 = c.y, mx = (x1 + x2) / 2;
          gEdges.appendChild(svgEl('path', { 'class': 'edge', d: 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 }));
        }
        draw(c);
      });
      if (n.depth < 0) return;
      var x = xOf(n), g;
      if (n.item) {
        g = svgEl('g', { 'class': 'node leaf', tabindex: 0, role: 'button', 'data-i': n.idx, 'aria-label': 'Preview ' + n.item.n + ' in ' + n.item.p });
        g.appendChild(svgEl('circle', { 'class': 'k-' + kindKey(n.item.k), cx: x, cy: n.y, r: 6 }));
        g.appendChild(svgEl('text', { x: x + 12, y: n.y + 4 }, trunc(n.label, 44)));
        g.appendChild(svgEl('title', {}, n.item.p));
      } else if (n.lane) {
        g = svgEl('g', { 'class': 'node' });
        g.appendChild(svgEl('circle', { 'class': 'lane-dot', cx: x, cy: n.y, r: 8 }));
        var lane = lanes.filter(function (l) { return l.label === n.label; })[0];
        var lx = narrow ? 18 : x + 14, ly = narrow ? lane.y0 + 18 : n.y + 4;
        g.appendChild(svgEl('text', { 'class': 'lane-label', x: lx, y: ly }, n.label));
        g.appendChild(svgEl('text', { 'class': 'count', x: narrow ? lx + n.label.length * 8 + 10 : lx, y: narrow ? ly : n.y + 18 }, n.leaves + ' match' + (n.leaves === 1 ? '' : 'es')));
      } else {
        var name = trunc(n.label.split('/').pop() === n.label || !narrow ? n.label : '…/' + n.label.split('/').pop(), FOLDER_CH);
        g = svgEl('g', { 'class': 'node toggle' + (n.collapsed ? ' closed' : ''), tabindex: 0, role: 'button', 'data-key': n.key,
          'aria-expanded': String(!n.collapsed), 'aria-label': (n.collapsed ? 'Open ' : 'Close ') + n.label + ', ' + n.leaves + ' matches' });
        g.appendChild(svgEl('circle', { 'class': 'k-folder', cx: x, cy: n.y, r: n.collapsed ? 7 : 5 }));
        if (n.collapsed) {
          g.appendChild(svgEl('text', { 'class': 'plus', x: x, y: n.y + 3.5 }, '+'));
          g.appendChild(svgEl('text', { x: x + 13, y: n.y + 4 }, name));
          g.appendChild(svgEl('text', { 'class': 'count', x: x + 13 + name.length * 6.6 + 8, y: n.y + 4 }, n.leaves + ' inside'));
        } else {
          g.appendChild(svgEl('text', { x: x + 11, y: n.y - 7 }, name));
        }
        g.appendChild(svgEl('title', {}, n.label + ' (' + n.leaves + ')'));
      }
      gNodes.appendChild(g);
    })(tree);

    var total = state.results.length;
    $('mapNote').textContent = (total > MAP_LEAVES ? 'Showing the top ' + MAP_LEAVES + ' of ' + nf(total) + ' matches. ' : '') +
      'One lane per place things live. Click a file to preview it, or a folder to open or close it.';
  }

  // ---------- tabs ----------
  function setTab(tab) {
    state.tab = tab;
    var list = tab === 'list';
    $('tabList').setAttribute('aria-selected', list); $('tabMap').setAttribute('aria-selected', !list);
    $('tabList').tabIndex = list ? 0 : -1; $('tabMap').tabIndex = list ? -1 : 0;
    placeInk();
    render();
  }
  function placeInk() {
    var b = state.tab === 'list' ? $('tabList') : $('tabMap'), ink = document.querySelector('.tab-ink');
    ink.style.width = b.offsetWidth + 'px';
    ink.style.transform = 'translateX(' + (b.offsetLeft - 4) + 'px)';
  }

  // ---------- preview ----------
  function closePreview() {
    if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; }
    $('pvBody').textContent = '';
    $('preview').hidden = true;
    document.body.classList.remove('pv-open');
    state.openItem = null;
  }

  function openPreview(it) {
    closePreview();
    state.openItem = it;
    $('pvReveal').hidden = true;
    var p = $('preview');
    $('pvName').textContent = it.n;
    $('pvDot').style.background = kindColor(it.k);
    $('pvPath').textContent = it.p;
    var meta = [['Kind', (KINDS.filter(function (k) { return k[0] === it.k; })[0] || [0, it.k === 'proc' ? 'Process' : 'File'])[1]],
      ['Where', it.src + (it.demo ? ' (demo)' : '')]];
    if (it.k !== 'web' && it.k !== 'proc' && it.k !== 'folder') meta.push(['Size', fmtSize(it.z)]);
    meta.push([it.k === 'web' ? 'Last visit' : it.k === 'proc' ? 'Started' : 'Modified', fmtDate(it.t)]);
    $('pvMeta').innerHTML = meta.map(function (m) { return '<dt>' + esc(m[0]) + '</dt><dd>' + esc(m[1]) + '</dd>'; }).join('');
    $('pvBody').innerHTML = '<div class="spinner" aria-label="Reading"></div>';
    $('pvFoot').textContent = '';
    p.hidden = false;
    document.body.classList.add('pv-open');
    addRecent(state.q.trim());
    if (it.demo) { demoPreview(it); return; }
    $('pvReveal').hidden = !(it.native && it.s === 'files');
    if (it.native) { nativePreview(it); return; }
    var t0 = performance.now();
    var getFile = it.file ? Promise.resolve(it.file) : it.h.getFile();
    getFile.then(function (file) {
      if (state.openItem !== it) return;
      if (!it.z) { it.z = file.size; it.t = file.lastModified; }
      if (file.size === 0) { msg('This file is empty.'); return foot(0, file.size, t0); }
      var isImg = /^image\//.test(file.type) || it.k === 'img';
      if (isImg && /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml|x-icon)$/.test(file.type)) {
        if (file.size > IMAGE_MAX) { msg('Image is ' + fmtSize(file.size) + '. Previews stop at ' + fmtSize(IMAGE_MAX) + ', so nothing was read.'); return foot(0, file.size, t0); }
        state.objectUrl = URL.createObjectURL(file);
        var img = new Image();
        img.alt = 'Preview of ' + it.n;
        img.onload = function () { foot(file.size, file.size, t0, 'whole image, shown locally'); };
        img.onerror = function () { msg('This image format cannot be shown by your browser.'); };
        img.src = state.objectUrl;
        $('pvBody').textContent = ''; $('pvBody').appendChild(img);
        return;
      }
      if (it.k === 'media' || it.k === 'arch' || /pdf|officedocument|msword|zip/.test(file.type)) {
        msg('No preview for this kind of file. LocatorZero only reads text and images, so the details above are all there is.');
        return foot(0, file.size, t0);
      }
      return file.slice(0, PREVIEW_MAX).arrayBuffer().then(function (buf) {
        if (state.openItem !== it) return;
        var bytes = new Uint8Array(buf), nul = 0;
        for (var i = 0; i < Math.min(bytes.length, 4096); i++) if (bytes[i] === 0) nul++;
        var pre = document.createElement('pre');
        if (nul > 0 && !TEXT_EXT.test(it.n)) {
          pre.textContent = 'Binary file. First 512 bytes as hex:\n\n' + hexdump(bytes.subarray(0, 512));
        } else {
          pre.textContent = new TextDecoder('utf-8', { fatal: false }).decode(bytes) + (file.size > PREVIEW_MAX ? '\n\n… preview stops at 64 KB' : '');
        }
        var read = bytes.length;
        bytes.fill(0); // wipe our copy of the bytes as soon as they are on screen
        $('pvBody').textContent = ''; $('pvBody').appendChild(pre);
        foot(read, file.size, t0);
      });
    }).catch(function (e) {
      if (e && e.name === 'NotFoundError') {
        msg('This file no longer exists, so it has been removed from your results.');
        dropItem(it); search();
        return;
      }
      msg('The browser would not let LocatorZero open this file (' + esc(e.name || 'error') + '). It may have moved, or access was withdrawn.');
    });
  }

  function hexdump(b) {
    var out = '';
    for (var i = 0; i < b.length; i += 16) {
      var row = Array.prototype.slice.call(b.subarray(i, i + 16));
      out += i.toString(16).padStart(6, '0') + '  ' + row.map(function (x) { return x.toString(16).padStart(2, '0'); }).join(' ').padEnd(48) +
        '  ' + row.map(function (x) { return x >= 32 && x < 127 ? String.fromCharCode(x) : '.'; }).join('') + '\n';
    }
    return out;
  }
  function msg(text) { $('pvBody').innerHTML = '<div class="pv-msg">' + text + '</div>'; }
  function foot(read, size, t0, note) {
    if (note === 'demo') {
      $('pvFoot').textContent = 'Demo content, made up on the spot. Nothing on your device was read.';
      return;
    }
    state.reads += read ? 1 : 0; state.readBytes += read;
    var ms = performance.now() - t0;
    $('pvFoot').textContent = read
      ? 'Read ' + fmtSize(read) + ' of ' + fmtSize(size) + ' in ' + ms.toFixed(1) + ' ms' + (note ? ', ' + note : '') + '. Kept in this tab only and cleared when you close the preview.'
      : 'Nothing was read from inside this file.';
  }

  function nativePreview(it) {
    var t0 = performance.now();
    NATIVE.preview(it.p).then(function (out) {
      if (state.openItem !== it) return;
      if (out.kind === 'empty') { msg('This file is empty.'); return foot(0, out.size, t0); }
      if (out.kind === 'none') { msg(out.body ? esc(out.body) : 'No preview for this kind of file. LocatorZero only reads text and images, so the details above are all there is.'); return foot(0, out.size, t0); }
      var body = $('pvBody');
      body.textContent = '';
      if (out.kind === 'image') {
        var img = new Image(); img.alt = 'Preview of ' + it.n; img.src = out.body; body.appendChild(img);
        out.body = '';
        return foot(out.read, out.size, t0, 'whole image, shown locally');
      }
      var pre = document.createElement('pre');
      pre.textContent = out.kind === 'binary' ? 'Binary file. First 512 bytes as hex:\n\n' + out.body
        : out.body + (out.size > PREVIEW_MAX ? '\n\n… preview stops at 64 KB' : '');
      out.body = '';
      body.appendChild(pre);
      foot(out.read, out.size, t0);
    }, function (e) {
      if (state.openItem === it) msg('Could not open this file: ' + esc(String(e)) + '. It may have moved, or you may not have permission.');
    });
  }

  function handoff(it) {
    if (!NATIVE) return;
    NATIVE.reveal(it.url ? null : it.p, it.url || null).then(function () {
      toast(it.url ? 'Opened in your browser 🌐' : 'Showing it in your file manager 📂');
    }, function (e) { toast('Could not hand off: ' + e); });
  }

  function renderNativeSources() {
    var box = $('nativeSources');
    if (!NATIVE || !state.nativeStatus) return;
    box.hidden = false;
    box.innerHTML = state.nativeStatus.sources.map(function (s) {
      return '<label class="row-toggle"><input type="checkbox" data-src="' + s.id + '"' + (state.native[s.id] && s.available ? ' checked' : '') + (s.available ? '' : ' disabled') + '>' +
        ' <span>' + esc(s.label) + (s.degraded ? ' <em class="degraded">limited</em>' : '') +
        '<small>' + esc(s.mode) + (s.age_ms != null && s.id === 'files' ? ' · updated ' + fmtAgo(Date.now() - s.age_ms) : '') + '</small>' +
        '<small>' + esc(s.note) + '</small></span></label>' +
        (s.id === 'tabs' && s.available ? '<div class="tabs-setup"><button class="btn btn-soft wide" id="setupTabs">Set up open tabs</button><div id="tabsHelp"></div></div>' : '');
    }).join('');
  }

  // ---------- version and what's new ----------
  // Keep LZ_VERSION equal to desktop/src-tauri/tauri.conf.json (an end-to-end test checks it), and add each release
  // to CHANGES and CHANGELOG.md.
  var LZ_VERSION = '0.2.0';
  var CHANGES = [
    { v: '0.2.0', date: 'October 2026', title: 'Clean up: free up space, safely', items: [
      '<b>Clean up</b> (menu → Clean up): finds files stored more than once, and your biggest files, in a place you choose, in seconds.',
      'See them as a list, or on a <b>map</b> of every folder that holds a copy. Green stays, red goes.',
      '<b>Tick all extra copies</b> in one click. One copy of every file always stays.',
      'Nothing moves until you confirm. Each copy is checked byte for byte first, then goes to the <span class="cl-bin">Recycle Bin</span>, so you can restore it.',
      '<b>About</b> and <b>What\'s new</b> in the menu, so you can always see your version and what changed.',
      'Welcome tour: a new slide about Clean up.'] },
    { v: '0.1.0', date: 'October 2026', title: 'First release', items: [
      'One search across your computer, drives, cloud folders, browser history, open tabs and running apps.',
      'Locations and Map views, Preview, Show in folder, light and dark themes.',
      'Private by design: no internet connection, nothing kept, consent before each place.',
      '90-day free trial and offline licence keys.'] }
  ];
  function appVersion() { return (state.nativeStatus && state.nativeStatus.version) || LZ_VERSION; }
  function renderAbout() {
    $('aboutVer').textContent = appVersion();
    $('aboutKind').textContent = NATIVE ? '· desktop app' : '· web app, always the latest';
  }
  function openWhatsNew() {
    setSidebar(false);
    var cur = CHANGES[0];
    $('wnTitle').textContent = 'What\'s new in ' + cur.v;
    $('wnBody').innerHTML = CHANGES.map(function (c, i) {
      var list = '<ul class="ticks">' + c.items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
      return i === 0 ? '<p class="wn-sub"><b>' + esc(c.title) + '</b> · ' + esc(c.date) + '</p>' + list
        : '<details class="wn-old"><summary>Version ' + esc(c.v) + ': ' + esc(c.title) + '</summary>' + list + '</details>';
    }).join('');
    applyBinNames();
    lsSet('lz.seenVersion', LZ_VERSION);
    if (!$('whatsNew').open) $('whatsNew').showModal();
  }
  // Someone who used an earlier version sees What's new once, after the tour.
  function updatedSinceLastVisit() {
    var seen = lsGet('lz.seenVersion');
    return seen ? seen !== LZ_VERSION : lsGet('lz.welcomed') === '1';
  }
  function afterIntro() {
    if (NATIVE && !hasConsent('everywhere') && state.scope.type === 'everywhere') setTimeout(function () { if (!$('plans').open && !$('whatsNew').open) askEverywhere(); }, 250);
    else $('q').focus();
  }

  // ---------- clean up ----------
  // Duplicate and largest files in one place the user chose. Desktop: the Rust core lists, compares and, only after
  // the user confirms, moves files to the system's bin (cleanup.rs). Web: a made-up demo computer; nothing is moved.
  var CL = { scan: null, sel: {}, group: {}, size: {}, skipped: [], tab: 'dup', timer: null, token: null, places: [] };
  var CL_MAP_GROUPS = 40, CL_LIST_GROUPS = 200;
  function binName() { return /Win/.test(navigator.platform || '') ? 'Recycle Bin' : 'Trash'; }
  function applyBinNames() {
    var bin = binName();
    Array.prototype.forEach.call(document.querySelectorAll('.cl-bin'), function (e) { e.textContent = bin; });
  }
  function demoScan() {
    var H = '/Users/alex', MB = 1048576, GB = 1024 * MB, T = window.LZ_DEMO ? window.LZ_DEMO.now : Date.now(), D = 864e5;
    function f(p, size, daysAgo) { return { path: p, name: lastSeg(p), size: Math.round(size), t: T - daysAgo * D }; }
    var sets = [
      [1.42 * GB, [H + '/Downloads/wedding-photos.zip', '/Volumes/Backup/Archive/wedding-photos.zip']],
      [182 * MB, [H + '/Movies/project-atlas-demo.mp4', H + '/Desktop/project-atlas-demo.mp4', H + '/Downloads/project-atlas-demo (1).mp4']],
      [68 * MB, [H + '/Downloads/ZoomInstaller.pkg', H + '/Downloads/ZoomInstaller (1).pkg']],
      [24 * MB, [H + '/Pictures/WhatsApp/VID-20260314-WA0007.mp4', H + '/Downloads/VID-20260314-WA0007.mp4', '/Volumes/Backup/Phone/VID-20260314-WA0007.mp4']],
      [4.2 * MB, [H + '/Pictures/2025/Goa/IMG_2041.jpg', H + '/Downloads/IMG_2041.jpg', '/Volumes/Backup/Photos/Goa/IMG_2041.jpg']],
      [1.1 * MB, [H + '/Documents/Taxes/tax-return-2025.pdf', H + '/Downloads/tax-return-2025.pdf', H + '/Downloads/tax-return-2025 (1).pdf']]
    ];
    var groups = sets.map(function (s, i) {
      var files = s[1].map(function (p, j) { return f(p, s[0], 400 - i * 40 - j * 9); });
      return { size: files[0].size, wasted: files[0].size * (files.length - 1), files: files };
    });
    var largest = [f('/Volumes/Backup/vm/windows11.vhdx', 22 * GB, 300), f(H + '/Downloads/Xcode_16.xip', 3.1 * GB, 120), f(H + '/Movies/family-reunion-2024.mov', 2.3 * GB, 500)];
    groups.forEach(function (g) { g.files.forEach(function (x) { largest.push(x); }); });
    largest.sort(function (a, b) { return b.size - a.size; });
    return { root: 'Demo computer', files: 48213, groups: groups, wasted: groups.reduce(function (a, g) { return a + g.wasted; }, 0),
      largest: largest.slice(0, 12), ms: 1240, truncated: false };
  }
  function showClean(step) { $('clStart').hidden = step !== 'start'; $('clBusy').hidden = step !== 'busy'; $('clResults').hidden = step !== 'results'; }
  function clPlaceBtn(id, ico, title, sub) {
    return '<button class="cl-place" data-place="' + id + '"><span class="ico" aria-hidden="true">' + ico + '</span><span><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span></button>';
  }
  function renderCleanPlaces() {
    var box = $('clPlaces');
    if (!NATIVE) { box.innerHTML = clPlaceBtn('demo', '🖥️', 'Demo computer', 'Made-up files: try it safely'); return; }
    box.innerHTML = '<p class="small muted">Finding your places…</p>';
    NATIVE.places().then(function (places) {
      CL.places = places;
      box.innerHTML = places.map(function (p, i) { return clPlaceBtn(i, PLACE_ICO[p.kind] || '📁', p.label, p.path); }).join('') +
        clPlaceBtn('pick', '📂', 'Choose a folder…', 'Your system\'s folder picker');
    }, function () { box.innerHTML = clPlaceBtn('pick', '📂', 'Choose a folder…', 'Your system\'s folder picker'); });
  }
  function openClean() {
    setSidebar(false);
    applyBinNames();
    $('ccYes').textContent = 'Move to ' + binName();
    if (!CL.scan) { showClean('start'); renderCleanPlaces(); } else renderClean();
    if (!$('clean').open) $('clean').showModal();
  }
  function askCleanConsent(place) {
    var key = 'clean:' + place.path;
    if (state.consented[key]) return startScan(place);
    askConsent({
      key: key, ico: PLACE_ICO[place.kind] || '📁', where: place.path, promise: false, yes: 'Allow and look',
      title: 'Look for duplicates in “' + place.label + '”?',
      reads: ['<b>File names, sizes and dates</b> in this place, listed into memory only. System and app folders are skipped',
        '<b>For files of the same size, three small samples of each</b> (48 KB in all), read in memory to compare them',
        '<b>Nothing is changed.</b> Files move to the ' + binName() + ' only after you tick them and confirm']
    }).then(function (ok) { if (ok) startScan(place); });
  }
  function startScan(place) {
    var t = CL.token = {};
    showClean('busy'); $('clBusyText').textContent = 'Listing files…';
    clearInterval(CL.timer);
    CL.timer = setInterval(function () {
      NATIVE.cleanup.progress().then(function (p) {
        if (CL.token !== t) return;
        $('clBusyText').textContent = p.phase === 2 ? 'Comparing ' + nf(p.compared) + ' of ' + nf(p.to_compare) + ' files that share a size…'
          : 'Listing files… ' + nf(p.files) + ' so far';
      }, function () {});
    }, 300);
    NATIVE.cleanup.scan(place.path).then(function (s) {
      if (CL.token !== t) return;
      clearInterval(CL.timer); setScan(s, place.label);
    }, function (e) {
      if (CL.token !== t) return;
      clearInterval(CL.timer); showClean('start'); renderCleanPlaces();
      toast(String(e) === 'stopped' ? 'Stopped.' : 'Could not look there: ' + e);
    });
  }
  function runDemoScan() {
    var t = CL.token = {};
    showClean('busy');
    var steps = ['Listing files… 18,402 so far', 'Listing files… 48,213 so far', 'Comparing 211 of 486 files that share a size…'];
    steps.forEach(function (s, i) { setTimeout(function () { if (CL.token === t) $('clBusyText').textContent = s; }, i * 450); });
    setTimeout(function () { if (CL.token === t) setScan(demoScan(), 'the demo computer'); }, 1400);
  }
  function stopScan() {
    CL.token = null; clearInterval(CL.timer);
    if (NATIVE) NATIVE.cleanup.stop().catch(function () {});
    showClean('start'); renderCleanPlaces();
  }
  function indexScan() {
    CL.group = {}; CL.size = {};
    CL.scan.groups.forEach(function (g, gi) { g.files.forEach(function (f) { CL.group[f.path] = gi; CL.size[f.path] = f.size; }); });
    CL.scan.largest.forEach(function (f) { CL.size[f.path] = f.size; });
  }
  function setScan(s, label) {
    CL.scan = s; CL.label = label; CL.sel = {}; CL.skipped = []; CL.freed = 0;
    indexScan();
    showClean('results');
    setCleanTab(s.groups.length ? 'dup' : 'big');
  }
  // The copy that stays: the oldest one not ticked.
  function keeperOf(gi) {
    var files = CL.scan.groups[gi].files;
    for (var i = 0; i < files.length; i++) if (!CL.sel[files[i].path]) return files[i].path;
    return null;
  }
  function toggleSel(path, on) {
    var gi = CL.group[path];
    if (on && gi != null) {
      var left = CL.scan.groups[gi].files.filter(function (f) { return !CL.sel[f.path] && f.path !== path; }).length;
      if (!left) { toast('One copy always stays. Untick another copy first.'); return false; }
    }
    if (on) CL.sel[path] = true; else delete CL.sel[path];
    return true;
  }
  function selBytes(paths) { return paths.reduce(function (a, p) { return a + (CL.size[p] || 0); }, 0); }
  function clRow(f, keep, showSize) {
    var on = !!CL.sel[f.path];
    return '<label class="cl-row' + (on ? ' ticked' : '') + '"><input type="checkbox" data-p="' + esc(f.path) + '"' + (on ? ' checked' : '') +
      ' aria-label="Tick ' + esc(f.path) + '"><span class="cl-path">' + esc(f.path) + (keep ? '<em class="cl-keep">stays</em>' : '') + '</span><small>' +
      (showSize ? fmtSize(f.size) + ' · ' : '') + new Date(f.t).toLocaleDateString() + '</small></label>';
  }
  function setCleanTab(tab) {
    CL.tab = tab;
    [['dup', 'clTabDup', 'clDup'], ['map', 'clTabMap', 'clMapWrap'], ['big', 'clTabBig', 'clBig']].forEach(function (x) {
      $(x[1]).setAttribute('aria-selected', String(x[0] === tab)); $(x[2]).hidden = x[0] !== tab;
    });
    renderClean();
  }
  function renderClean() {
    var s = CL.scan; if (!s) return;
    var n = s.groups.length;
    var sum = n ? '<b>' + nf(n) + ' set' + (n === 1 ? '' : 's') + ' of duplicates</b> in ' + esc(CL.label) + ': <b>' + fmtSize(s.wasted) + '</b> can be freed by keeping one copy of each.'
      : CL.freed ? '<b>All duplicates cleaned up</b> in ' + esc(CL.label) + ': ' + fmtSize(CL.freed) + ' freed 🎉'
      : '<b>No duplicates found</b> in ' + esc(CL.label) + ' 🎉 The Largest files tab shows what takes the most space.';
    if (CL.freed && n) sum += ' <b>' + fmtSize(CL.freed) + ' freed so far.</b>';
    sum += ' <span class="small">' + nf(s.files) + ' files checked in ' + (s.ms / 1000).toFixed(1) + ' s' + (s.truncated ? ', stopping at 2 million' : '') + '.</span>';
    if (CL.skipped.length) sum += '<span class="cl-skipped">' + CL.skipped.length + ' not moved: ' +
      esc(CL.skipped.slice(0, 3).map(function (x) { return lastSeg(x[0]) + ' (' + x[1] + ')'; }).join('; ')) + (CL.skipped.length > 3 ? '…' : '') + '</span>';
    $('clSummary').innerHTML = sum;
    if (CL.tab === 'dup') {
      var pane = $('clDup'), top = pane.scrollTop;
      pane.innerHTML = !n ? '<div class="cl-empty">No file is stored twice here.</div>' : s.groups.slice(0, CL_LIST_GROUPS).map(function (g, gi) {
        var keep = keeperOf(gi);
        return '<div class="cl-group"><div class="cl-gh"><b>' + esc(g.files[0].name) + '</b><span>' + g.files.length + ' copies · ' + fmtSize(g.size) +
          ' each</span><span class="cl-free">frees ' + fmtSize(g.wasted) + '</span></div>' + g.files.map(function (f) { return clRow(f, f.path === keep, false); }).join('') + '</div>';
      }).join('') + (n > CL_LIST_GROUPS ? '<div class="cl-empty small">Showing the ' + CL_LIST_GROUPS + ' sets that free the most space.</div>' : '');
      pane.scrollTop = top;
    } else if (CL.tab === 'big') {
      var bp = $('clBig'), btop = bp.scrollTop;
      bp.innerHTML = s.largest.length ? s.largest.map(function (f) { return clRow(f, false, true); }).join('') : '<div class="cl-empty">No files here.</div>';
      bp.scrollTop = btop;
    } else renderCleanMap();
    var paths = Object.keys(CL.sel);
    $('clSel').textContent = paths.length ? paths.length + ' file' + (paths.length === 1 ? '' : 's') + ' ticked · ' + fmtSize(selBytes(paths)) : 'Nothing ticked';
    $('clGo').disabled = !paths.length;
    $('clGo').textContent = 'Move to ' + binName();
    $('clAuto').hidden = !n;
  }
  // One lane per duplicated file, branching to every folder that holds a copy. Green stays, red is ticked.
  function renderCleanMap() {
    var svg = $('clMap');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var groups = CL.scan.groups.slice(0, CL_MAP_GROUPS);
    if (!groups.length) { svg.setAttribute('width', 0); svg.setAttribute('height', 0); $('clMapNote').textContent = 'No duplicates to map.'; return; }
    var items = [], keep = {}, laneGi = {};
    groups.forEach(function (g, gi) {
      keep[keeperOf(gi)] = true;
      var lane = (gi + 1) + '. ' + g.files[0].name;
      laneGi[lane] = gi;
      g.files.forEach(function (f) { items.push({ p: f.path, n: f.name, src: lane }); });
    });
    var tree = buildTree(items), ROW = 24, COL = 170, PADX = 22, y = 12, maxDepth = 0, lanes = [];
    (function layout(n, depth) {
      n.depth = depth; if (depth > maxDepth) maxDepth = depth;
      if (n.item) { n.y = y; y += ROW; return; }
      var start = y;
      if (n.lane) y += 40; // the lane title gets its own line, clear of the folder names below it
      n.order.forEach(function (k) { layout(n.kids[k], depth + 1); });
      var first = n.kids[n.order[0]], last = n.kids[n.order[n.order.length - 1]];
      n.y = !n.order.length ? y : n.lane ? first.y : (first.y + last.y) / 2;
      if (n.lane) { lanes.push({ n: n, y0: start, y1: y + 2 }); y += 12; }
    })(tree, -1);
    var width = PADX * 2 + maxDepth * COL + 300, height = y + 8;
    svg.setAttribute('width', width); svg.setAttribute('height', height); svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    var gL = svgEl('g', {}), gE = svgEl('g', {}), gN = svgEl('g', {});
    svg.appendChild(gL); svg.appendChild(gE); svg.appendChild(gN);
    lanes.forEach(function (l) {
      var g = CL.scan.groups[laneGi[l.n.label]];
      gL.appendChild(svgEl('rect', { 'class': 'lane-bg', x: 6, y: l.y0, width: width - 12, height: l.y1 - l.y0, rx: 12 }));
      var title = svgEl('text', { 'class': 'lane-label', x: 18, y: l.y0 + 18 }, trunc(l.n.label, 60) + '  ·  ' + g.files.length + ' copies, ' + fmtSize(g.size) + ' each  ·  ');
      title.appendChild(svgEl('tspan', { 'class': 'count' }, 'frees ' + fmtSize(g.wasted)));
      gL.appendChild(title);
    });
    function xOf(n) { return PADX + n.depth * COL; }
    (function draw(n) {
      n.order.forEach(function (k) {
        var c = n.kids[k];
        if (n.depth >= 0) {
          var x1 = xOf(n) + 6, y1 = n.y, x2 = xOf(c) - 6, y2 = c.y, mx = (x1 + x2) / 2;
          gE.appendChild(svgEl('path', { 'class': 'edge', d: 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 }));
        }
        draw(c);
      });
      if (n.depth < 0) return;
      var x = xOf(n), g;
      if (n.item) {
        var p = n.item.p, on = !!CL.sel[p], stays = !!keep[p];
        g = svgEl('g', { 'class': 'node leaf' + (on ? ' ticked' : '') + (stays ? ' keep' : ''), tabindex: 0, role: 'checkbox', 'aria-checked': String(on), 'data-p': p,
          'aria-label': (on ? 'Ticked: ' : stays ? 'Stays: ' : '') + p });
        g.appendChild(svgEl('circle', { cx: x, cy: n.y, r: 6 }));
        g.appendChild(svgEl('text', { x: x + 12, y: n.y + 4 }, trunc(n.label, 40) + (stays ? '  (stays)' : '')));
        g.appendChild(svgEl('title', {}, p));
      } else if (n.lane) {
        g = svgEl('g', { 'class': 'node' });
        g.appendChild(svgEl('circle', { 'class': 'lane-dot', cx: x, cy: n.y, r: 7 }));
      } else {
        g = svgEl('g', { 'class': 'node' });
        g.appendChild(svgEl('circle', { 'class': 'k-folder', cx: x, cy: n.y, r: 5 }));
        g.appendChild(svgEl('text', { x: x + 11, y: n.y - 7 }, trunc(n.label, 22)));
        g.appendChild(svgEl('title', {}, n.label));
      }
      gN.appendChild(g);
    })(tree);
    $('clMapNote').textContent = 'Each lane is one file stored more than once, branching to every folder that holds a copy. Green stays; click a copy to tick or untick it.' +
      (CL.scan.groups.length > CL_MAP_GROUPS ? ' Showing the ' + CL_MAP_GROUPS + ' sets that free the most space.' : '');
  }
  function autoTick() {
    var count = 0;
    CL.scan.groups.forEach(function (g) {
      g.files.forEach(function (f, i) { if (i === 0) delete CL.sel[f.path]; else if (!CL.sel[f.path]) { CL.sel[f.path] = true; count++; } });
    });
    renderClean();
    toast(count ? 'Ticked ' + count + ' extra cop' + (count === 1 ? 'y' : 'ies') + '. The oldest copy of each file stays.' : 'Every extra copy is already ticked.');
  }
  function confirmClean() {
    var paths = Object.keys(CL.sel); if (!paths.length) return;
    $('ccTitle').textContent = 'Move ' + paths.length + ' file' + (paths.length === 1 ? '' : 's') + ' to the ' + binName() + '?';
    $('ccText').textContent = 'This frees about ' + fmtSize(selBytes(paths)) + '. Please check the list:';
    $('ccList').innerHTML = paths.slice(0, 8).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') +
      (paths.length > 8 ? '<li>…and ' + (paths.length - 8) + ' more</li>' : '');
    $('clConfirm').showModal();
  }
  function dropFromScan(moved) {
    var gone = {}; moved.forEach(function (p) { gone[p] = true; delete CL.sel[p]; });
    var s = CL.scan;
    s.groups = s.groups.map(function (g) {
      var files = g.files.filter(function (f) { return !gone[f.path]; });
      return { size: g.size, wasted: g.size * Math.max(files.length - 1, 0), files: files };
    }).filter(function (g) { return g.files.length > 1; });
    s.wasted = s.groups.reduce(function (a, g) { return a + g.wasted; }, 0);
    s.largest = s.largest.filter(function (f) { return !gone[f.path]; });
    indexScan();
  }
  function doClean() {
    var paths = Object.keys(CL.sel);
    var items = paths.map(function (p) { var gi = CL.group[p]; return { path: p, keep: gi == null ? null : keeperOf(gi) }; });
    var bin = binName();
    function done(out) {
      CL.skipped = out.skipped || [];
      CL.freed += out.freed || 0;
      CL.skipped.forEach(function (x) { delete CL.sel[x[0]]; });
      dropFromScan(out.moved);
      renderClean();
      return out;
    }
    if (!NATIVE) {
      done({ moved: paths, skipped: [], freed: selBytes(paths) });
      toast('Demo: in the desktop app, ' + paths.length + ' file' + (paths.length === 1 ? '' : 's') + ' would now be in the ' + bin + ' 🧹');
      return;
    }
    $('clGo').disabled = true; $('clGo').textContent = 'Checking and moving…';
    NATIVE.cleanup.trash(items).then(function (out) {
      done(out);
      toast(out.moved.length ? 'Moved ' + out.moved.length + ' file' + (out.moved.length === 1 ? '' : 's') + ' to the ' + bin + ' · ' + fmtSize(out.freed) + ' freed 🧹'
        : 'Nothing was moved. The summary says why.');
    }, function (e) { toast('Could not move files: ' + e); renderClean(); });
  }

  // ---------- store ----------
  // Checkout opens in the browser on Lemon Squeezy's site; this app never connects anywhere itself.
  // Keep live false until the store is activated: until then the buttons say "Store opens soon".
  var STORE = {
    live: false,
    checkout: {
      monthly: 'https://locatorzero.lemonsqueezy.com/checkout/buy/1f9eada9-1be7-41de-92b9-879cdaf17e1d',
      pro: 'https://locatorzero.lemonsqueezy.com/checkout/buy/472fe712-1274-42af-a7d8-5f52ec86be81',
      lifetime: 'https://locatorzero.lemonsqueezy.com/checkout/buy/cf392554-b89f-483d-ada0-6fda3d56b779'
    }
  };
  function openExternal(url) {
    if (NATIVE) NATIVE.reveal(null, url).catch(function (err) { toast(String(err)); });
    else window.open(url, '_blank', 'noopener,noreferrer');
  }
  function renderStore() {
    var labels = { monthly: 'Buy Monthly', pro: 'Buy Pro', lifetime: 'Buy Lifetime' };
    Array.prototype.forEach.call(document.querySelectorAll('.p-buy'), function (b) {
      b.disabled = !STORE.live;
      b.textContent = STORE.live ? labels[b.dataset.plan] : 'Store opens soon';
    });
  }

  // ---------- licence (desktop) ----------
  var PLAN_NAMES = { monthly: 'Monthly', pro: 'Pro (yearly)', lifetime: 'Lifetime' };
  function refreshLicence() {
    if (!NATIVE) return Promise.resolve();
    return NATIVE.licence.status().then(function (st) {
      var first = !state.licence;
      state.licence = st;
      renderLicence();
      if (first && st.remind) toast('Your free trial ends in ' + st.trial_days_left + ' days. Plans start at $3 a month, or $35 once 😊');
      if (first && !(st.state === 'trial' || st.state === 'licensed')) {
        var mode = st.state === 'expired' ? 'expired' : 'ended';
        if ($('welcome').open) state.pendingPlans = mode; else openPlans(mode);
      }
    }, function () {});
  }
  function renderLicence() {
    var st = state.licence; if (!st) return;
    var html;
    if (st.state === 'licensed') {
      html = '<p><b>' + esc(PLAN_NAMES[st.plan] || st.plan) + ' licence</b> ✅<br><span class="muted small">' +
        (st.expires ? 'Renews or ends ' + esc(st.expires) : 'Never expires') + ' · order ' + esc(st.reference || '') + '</span></p>' +
        '<button class="btn btn-ghost wide" id="licRemove">Remove key from this computer</button>';
    } else if (st.state === 'trial') {
      html = '<p><b>Free trial</b>: ' + st.trial_days_left + ' day' + (st.trial_days_left === 1 ? '' : 's') + ' left</p>' +
        '<div class="lic-bar"><i></i></div><button class="btn btn-soft wide" id="licEnter">Enter a licence key</button>';
    } else {
      html = '<p><b>' + (st.state === 'expired' ? 'Your licence has expired' : 'Your free trial has ended') + '</b><br><span class="muted small">Searching this computer is paused until a key is entered.</span></p>' +
        '<button class="btn btn-primary wide" id="licEnter">See plans or enter a key</button>';
    }
    $('licBox').innerHTML = html;
    var bar = document.querySelector('#licBox .lic-bar i');
    if (bar) bar.style.width = Math.round((90 - st.trial_days_left) / 90 * 100) + '%'; // CSSOM, which the CSP allows
  }
  function openPlans(mode) {
    $('pTitle').textContent = mode === 'ended' ? 'Your 90-day trial has ended 😊' : mode === 'expired' ? 'Your licence has expired' : 'Plans & pricing';
    $('pIntro').textContent = mode === 'ended' ? 'Thanks for trying LocatorZero. Pick a plan to keep searching this computer. After you pay, you get a key that works offline.'
      : mode === 'expired' ? 'Renew to keep searching this computer, then use Get your key below for a fresh one.'
      : 'Use the desktop app free for 90 days. Then pick what suits you. No account needed: after you pay, you get a licence key that works offline.';
    $('pMsg').textContent = '';
    setSidebar(false);
    if (!$('plans').open) $('plans').showModal();
    if (NATIVE && mode) setTimeout(function () { $('pKey').focus(); }, 60);
  }
  function activateKey() {
    var key = $('pKey').value.trim();
    if (!key) { $('pMsg').textContent = 'Paste the key from your email first.'; return; }
    NATIVE.licence.activate(key).then(function (st) {
      state.licence = st; renderLicence();
      $('pKey').value = ''; $('plans').close();
      toast('Thank you! Your ' + (PLAN_NAMES[st.plan] || st.plan) + ' licence is active 💜');
      if (!hasConsent('everywhere')) askEverywhere(); else refreshNative();
    }, function (e) { $('pMsg').textContent = String(e); });
  }

  function demoPreview(it) {
    setTimeout(function () {
      if (state.openItem !== it) return;
      var t0 = performance.now(), body = $('pvBody'), pre = document.createElement('pre');
      body.textContent = '';
      if (it.k === 'img') {
        var hue = (it.n.length * 37) % 360;
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(' + hue + ',70%,60%)"/><stop offset="1" stop-color="hsl(' + ((hue + 80) % 360) + ',70%,45%)"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><circle cx="470" cy="130" r="54" fill="rgba(255,255,255,.55)"/><path d="M0 420 L210 210 L330 330 L430 250 L640 420Z" fill="rgba(0,0,0,.25)"/></svg>';
        var img = new Image(); img.alt = 'Demo image'; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        body.appendChild(img);
      } else if (it.k === 'web') {
        pre.textContent = 'Browser history entry (demo)\n\nTitle:    ' + it.n + '\nAddress:  https://' + it.p.split('/')[2] + '/…\nBrowser:  ' + it.p.split('/')[0] + ', ' + it.p.split('/')[1] +
          '\nVisited:  ' + fmtDate(it.t) + '\n\nThe desktop app reads this from the browser\'s own history file, read-only.\nIt never opens the page.';
        body.appendChild(pre);
      } else if (it.k === 'proc') {
        pre.textContent = 'Running process (demo)\n\n' + it.n + '\nOwner:    alex\nStarted:  ' + fmtDate(it.t) + '\n\nThe desktop app lists processes the way a task manager does.\nIt never reads their memory.';
        body.appendChild(pre);
      } else if (it.k === 'media' || it.k === 'arch') {
        msg('No preview for this kind of file. LocatorZero only reads text and images, so the details above are all there is.');
        return foot(0, it.z, t0, 'demo');
      } else if (it.k === 'data') {
        var rows = ['Category,Q1,Q2,Q3,Q4'], cats = ['Rent', 'Payroll', 'Software', 'Travel', 'Marketing', 'Hardware', 'Training', 'Misc'];
        cats.forEach(function (c, i) { rows.push(c + ',' + [1, 2, 3, 4].map(function (q) { return (((i + 3) * 1371 * q) % 9000 + 500); }).join(',')); });
        pre.textContent = rows.join('\n'); body.appendChild(pre);
      } else {
        pre.textContent = '# ' + it.n.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ') + '\n\nDemo content. This file does not exist; it lives in a made-up computer\nso you can see what a preview looks like before choosing a real folder.\n\n' +
          '- Owner: Alex\n- Last edited: ' + fmtDate(it.t) + '\n- Status: draft\n\nIn a real folder, Preview reads at most the first 64 KB of one file,\nshows it here, and keeps nothing.';
        body.appendChild(pre);
      }
      foot(0, it.z, t0, 'demo');
    }, 60);
  }

  // ---------- folders ----------
  function addFolder() {
    if (window.showDirectoryPicker) {
      window.showDirectoryPicker({ mode: 'read' }).then(walkHandle).catch(function (e) {
        if (e && e.name !== 'AbortError') toast('Could not open that folder: ' + e.message);
      });
    } else {
      $('dirInput').click();
    }
  }

  function newFolder(name) {
    var f = { id: nextFolderId++, name: name, items: [], done: false, cancelled: false };
    state.folders.push(f);
    state.scope = { type: 'folder', id: f.id };
    renderFolders(); renderScope();
    return f;
  }

  function skipDir(name) { return !state.includeHidden && (SKIP_DIRS[name] || name.charAt(0) === '.'); }

  function walkHandle(root) {
    var f = newFolder(root.name);
    var label = 'Your folder · ' + root.name;
    var stack = [[root, root.name]], count = 0, lastPaint = performance.now();
    (async function () {
      try {
        while (stack.length && !f.cancelled) {
          var top = stack.pop(), dir = top[0], base = top[1];
          for await (var entry of dir.values()) {
            if (f.cancelled) return;
            if (entry.kind === 'directory') {
              if (skipDir(entry.name)) continue;
              stack.push([entry, base + '/' + entry.name]);
              f.items.push(prep({ n: entry.name, p: base + '/' + entry.name, s: 'folder', src: label, k: 'folder', z: null, t: null }));
            } else {
              if (!state.includeHidden && entry.name.charAt(0) === '.') continue;
              f.items.push(prep({ n: entry.name, p: base + '/' + entry.name, s: 'folder', src: label, k: kindOf(entry.name), z: null, t: null, h: entry }));
            }
            if (++count >= ITEM_CAP) { stack.length = 0; toast('Stopped at ' + nf(ITEM_CAP) + ' items to keep memory bounded.'); break; }
            if (performance.now() - lastPaint > 250) {
              lastPaint = performance.now(); renderFolders(); if (state.q) scheduleSearch(); else renderScope();
              await new Promise(function (r) { setTimeout(r, 0); });
            }
          }
        }
      } catch (e) {
        toast('Some sub-folders could not be read: ' + e.message);
      }
      f.done = true;
      renderFolders(); if (state.q) scheduleSearch(); else renderScope();
      if (!f.cancelled) toast('Ready 😊 ' + nf(f.items.length) + ' items from “' + f.name + '”. Try typing part of a name.');
      fillMetadata(f);
    })();
  }

  // Sizes and dates arrive after the names, so search works the moment a name is seen.
  async function fillMetadata(f) {
    var todo = f.items.filter(function (it) { return it.h; });
    for (var i = 0; i < todo.length && !f.cancelled; i += 200) {
      await Promise.all(todo.slice(i, i + 200).map(function (it) {
        return it.h.getFile().then(function (file) { it.z = file.size; it.t = file.lastModified; }, function () {});
      }));
    }
    if (!f.cancelled && state.q) scheduleSearch();
  }

  function addFromInput(files) {
    if (!files.length) return;
    var rootName = (files[0].webkitRelativePath || files[0].name).split('/')[0];
    var f = newFolder(rootName), label = 'Your folder · ' + rootName, dirs = {};
    for (var i = 0; i < files.length && f.items.length < ITEM_CAP; i++) {
      var file = files[i], rel = file.webkitRelativePath || file.name, segs = rel.split('/');
      var hidden = false;
      for (var s = 1; s < segs.length; s++) if (skipDir(segs[s]) || (s === segs.length - 1 && !state.includeHidden && segs[s].charAt(0) === '.')) { hidden = true; break; }
      if (hidden) continue;
      for (var d = 2; d < segs.length; d++) {
        var dp = segs.slice(0, d).join('/');
        if (!dirs[dp]) { dirs[dp] = 1; f.items.push(prep({ n: segs[d - 1], p: dp, s: 'folder', src: label, k: 'folder', z: null, t: null })); }
      }
      f.items.push(prep({ n: file.name, p: rel, s: 'folder', src: label, k: kindOf(file.name), z: file.size, t: file.lastModified, file: file }));
    }
    f.done = true;
    renderFolders(); if (state.q) scheduleSearch(); else renderScope();
    toast('Ready 😊 ' + nf(f.items.length) + ' items from “' + f.name + '”. Nothing was uploaded, your browser just calls it that.');
  }

  function removeFolder(id) {
    state.folders = state.folders.filter(function (f) { if (f.id === id) { f.cancelled = true; f.items = []; return false; } return true; });
    if (state.scope.type === 'folder' && state.scope.id === id) state.scope = { type: 'all' };
    if (state.openItem && !state.openItem.demo) closePreview();
    renderFolders(); scheduleSearch();
  }

  function renderFolders() {
    $('folderList').innerHTML = state.folders.map(function (f) {
      return '<li><span title="' + esc(f.name) + '">📁 ' + esc(f.name) + '</span><em>' + nf(f.items.length) + (f.done ? '' : '…') + '</em>' +
        '<button data-id="' + f.id + '" aria-label="Remove ' + esc(f.name) + '" title="Release this folder">×</button></li>';
    }).join('');
  }

  // ---------- where to search, with consent ----------
  var PLACE_ICO = { home: '🏠', cloud: '☁️', usb: '💾', drive: '🗄️', network: '📡', folder: '📁' };
  function hasConsent(key) {
    return !!state.consented[key] || (key === 'everywhere' && lsGet('lz.consent') === 'everywhere');
  }

  // One consent dialog for every place. Resolves true only on "Allow".
  function askConsent(o) {
    return new Promise(function (resolve) {
      $('cIco').textContent = o.ico;
      $('cTitle').textContent = o.title;
      $('cWhere').textContent = o.where || '';
      $('cWhere').hidden = !o.where;
      $('cReads').innerHTML = o.reads.map(function (r) { return '<li>' + r + '</li>'; }).join('');
      $('cRememberRow').hidden = !o.remember;
      $('cPromise').hidden = o.promise === false;
      $('cYes').textContent = o.yes || 'Allow and search';
      $('cRemember').checked = true;
      var d = $('consent');
      function done(ok) {
        $('cYes').onclick = $('cNo').onclick = d.oncancel = null;
        if (d.open) d.close();
        if (ok && o.key) state.consented[o.key] = true;
        if (ok && o.remember && $('cRemember').checked) lsSet('lz.consent', o.key);
        resolve(ok);
      }
      $('cYes').onclick = function () { done(true); };
      $('cNo').onclick = function () { done(false); };
      d.oncancel = function (e) { e.preventDefault(); done(false); };
      setSidebar(false); closeScopeMenu();
      d.showModal();
    });
  }

  function askEverywhere() {
    return askConsent({
      key: 'everywhere', ico: '💻', remember: true,
      title: 'Allow LocatorZero to search this computer?',
      reads: ['<b>File and folder names, sizes and dates</b> on this computer and connected drives, from the search index your system already keeps',
        '<b>Your browsers\' history</b>, read-only. Private windows keep none, so they are never seen',
        '<b>Names of running apps</b>, the way a task manager shows them',
        '<b>Open tabs</b>, only if you add the LocatorZero Tabs extension']
    }).then(function (ok) {
      state.askedEverywhere = false;
      if (ok) { refreshNative(); $('q').focus(); toast('Thanks 😊 Searching this computer now.'); }
      else renderScope();
      return ok;
    });
  }

  function setScope(sc) {
    state.scope = sc;
    clearInterval(state.placeTimer);
    if (sc.type === 'place' && !sc.place.indexed) watchPlace(sc.place);
    refreshNative(); search(); $('q').focus();
  }

  // Drives the system index does not cover are listed into memory; show progress and refresh results while it runs.
  function watchPlace(place) {
    state.placeCount = 0; state.placeDone = false;
    state.placeTimer = setInterval(function () {
      NATIVE.placeProgress(place.path).then(function (r) {
        state.placeCount = r[0]; state.placeDone = r[1];
        if (state.q) refreshNative(); else renderScope();
        if (r[1]) clearInterval(state.placeTimer);
      });
    }, 800);
  }

  function choosePlace(place) {
    var key = 'place:' + place.path;
    var go = function () {
      if (!state.sessionPlaces.some(function (p) { return p.path === place.path; })) state.sessionPlaces.push(place);
      setScope({ type: 'place', place: place });
    };
    if (hasConsent(key)) return go();
    var what = place.kind === 'usb' || place.kind === 'drive' ? 'drive' : place.kind === 'network' ? 'network drive' : 'folder';
    askConsent({
      key: key, ico: PLACE_ICO[place.kind] || '📁', where: place.path,
      title: 'Allow LocatorZero to look in “' + place.label + '”?',
      reads: ['<b>File and folder names, sizes and dates</b> in this ' + what +
        (place.indexed ? ', from the search index your system already keeps' : ', listed into memory only, never written to disk'),
        'It asks again the next time you open LocatorZero']
    }).then(function (ok) { if (ok) go(); });
  }

  function pickFolderDesktop() {
    askConsent({
      key: null, ico: '📂', title: 'Choose a folder for LocatorZero to search?',
      reads: ['Your system\'s folder picker opens next. <b>LocatorZero sees only the folder you pick</b>',
        '<b>File and folder names, sizes and dates</b> inside it, listed into memory only, never written to disk']
    }).then(function (ok) {
      if (!ok) return;
      NATIVE.pickFolder().then(function (place) {
        if (!place) return;
        state.consented['place:' + place.path] = true;
        choosePlace(place);
      }, function (e) { toast('Could not open the folder picker: ' + e); });
    });
  }

  function chooseFolderWeb() {
    askConsent({
      key: null, ico: '📂', title: 'Let LocatorZero look in a folder on this device?',
      reads: ['Your browser\'s folder picker opens next. <b>LocatorZero sees only the folder you pick</b>, and only until you close this tab',
        '<b>File and folder names, sizes and dates</b> inside it']
    }).then(function (ok) { if (ok) addFolder(); });
  }
  function chooseFolder() { if (NATIVE) pickFolderDesktop(); else chooseFolderWeb(); }

  function scopeItem(attrs, ico, title, sub, checked) {
    return '<button class="scope-item" role="menuitemradio" aria-checked="' + !!checked + '" ' + attrs + '>' +
      '<span class="si-ico">' + ico + '</span><b>' + esc(title) + '</b>' + (checked ? '<span class="si-tick">✓</span>' : '<span></span>') +
      '<small>' + esc(sub) + '</small></button>';
  }
  function renderScopeMenu(places) {
    var sc = state.scope, html = '<h4>Where to search</h4>';
    if (NATIVE) {
      html += scopeItem('data-scope="everywhere"', '🌐', 'Everywhere', 'This computer, drives, browsers, open tabs and apps', sc.type === 'everywhere');
      var seen = {};
      places.concat(state.sessionPlaces).forEach(function (p, i) {
        if (seen[p.path]) return; seen[p.path] = 1;
        html += scopeItem('data-place="' + i + '"', PLACE_ICO[p.kind] || '📁', p.label, p.path + (p.indexed ? '' : ' · asks first'), sc.type === 'place' && sc.place.path === p.path);
      });
      state.menuPlaces = places.concat(state.sessionPlaces);
      html += scopeItem('data-choose="1"', '📂', 'Choose a folder…', 'Pick any folder. Asks first', false);
    } else {
      html += scopeItem('data-scope="all"', '🌐', 'Everything here', 'The demo computer and folders you\'ve added', sc.type === 'all');
      html += scopeItem('data-scope="demo"', '🧪', 'Demo computer', 'A made-up computer to try things on', sc.type === 'demo');
      state.folders.forEach(function (f) {
        html += scopeItem('data-folder="' + f.id + '"', '📁', f.name, nf(f.items.length) + ' items · this tab only', sc.type === 'folder' && sc.id === f.id);
      });
      html += scopeItem('data-choose="1"', '📂', 'Choose a folder on this device…', 'Asks first. Nothing is uploaded', false);
      html += '<p class="sm-foot">Your whole computer, every drive and browser: the desktop app.</p>';
    }
    $('scopeMenu').innerHTML = html;
  }
  function renderScopeBtn() {
    var sc = state.scope, ico = '🌐', label = NATIVE ? 'Everywhere' : 'Everything here';
    if (sc.type === 'demo') { ico = '🧪'; label = 'Demo computer'; }
    if (sc.type === 'folder') { ico = '📁'; var f = state.folders.filter(function (x) { return x.id === sc.id; })[0]; label = f ? f.name : 'Folder'; }
    if (sc.type === 'place') { ico = PLACE_ICO[sc.place.kind] || '📁'; label = sc.place.label; }
    $('scopeIco').textContent = ico; $('scopeLabel').textContent = label;
    $('scopeBtn').setAttribute('aria-label', 'Search in: ' + label + '. Change where to search');
  }
  function openScopeMenu() {
    var show = function (places) {
      renderScopeMenu(places || []);
      $('scopeMenu').hidden = false; $('scopeBtn').setAttribute('aria-expanded', 'true');
      var first = $('scopeMenu').querySelector('[aria-checked="true"]') || $('scopeMenu').querySelector('.scope-item');
      if (first) first.focus();
    };
    if (NATIVE) NATIVE.places().then(show, function () { show([]); }); else show();
  }
  function closeScopeMenu() { $('scopeMenu').hidden = true; $('scopeBtn').setAttribute('aria-expanded', 'false'); }

  // ---------- session, wipe and idle ----------
  function addRecent(q) {
    if (!q) return;
    state.recent = [q].concat(state.recent.filter(function (r) { return r !== q; })).slice(0, 8);
    renderRecent();
  }
  function renderRecent() {
    $('recentList').innerHTML = state.recent.length
      ? state.recent.map(function (r) { return '<li><button data-q="' + esc(r) + '">' + esc(r) + '</button></li>'; }).join('')
      : '<li class="muted small">Nothing yet.</li>';
  }

  function wipe(reason) {
    state.folders.forEach(function (f) { f.cancelled = true; f.items = []; });
    state.folders = [];
    state.recent = [];
    state.nativeHits = []; state.nativeQ = null;
    state.scope = { type: NATIVE ? 'everywhere' : 'all' };
    state.sessionPlaces = []; state.consented = {};
    clearInterval(state.placeTimer);
    if (NATIVE) NATIVE.forget().catch(function () {});
    CL.token = null; clearInterval(CL.timer); CL.scan = null; CL.sel = {};
    if ($('clean').open) $('clean').close();
    if ($('clConfirm').open) $('clConfirm').close();
    state.q = ''; $('q').value = '';
    state.reads = 0; state.readBytes = 0;
    closePreview();
    renderFolders(); renderRecent(); search();
    toast(reason || 'Wiped. Folders released, searches and previews cleared 🧹');
  }

  function hasSessionData() { return state.folders.length > 0 || state.sessionPlaces.length > 0 || state.q.length > 0 || state.recent.length > 0 || !!state.openItem; }
  function markActive() { state.lastActive = Date.now(); }
  function idleTick() {
    var idle = Date.now() - state.lastActive, el = $('tIdle');
    if (hasSessionData() && idle >= IDLE_MS) { wipe('Your searches were cleared after 5 idle minutes, as promised 🧹 Add a folder again whenever you like.'); markActive(); }
    var left = Math.max(0, IDLE_MS - (Date.now() - state.lastActive));
    var mins = Math.ceil(left / 60000);
    el.querySelector('.lg').textContent = hasSessionData() ? 'Searches clear in ' + mins + ' min if idle' : 'Searches clear after 5 min idle';
    el.querySelector('.sm').textContent = hasSessionData() ? 'Clears in ' + mins + ' min' : 'Clears in 5 min';
  }

  // ---------- trust strip and live checks ----------
  document.addEventListener('securitypolicyviolation', function (e) {
    if (e.effectiveDirective === 'connect-src' || e.violatedDirective === 'connect-src') state.blocked++;
  });
  function probeNetwork() {
    // Same origin on purpose: if the policy were ever missing, the probe would reach only our own host and carry nothing.
    return fetch('./__lz_probe__?' + Date.now(), { cache: 'no-store' }).then(function () {
      setNet('open');
    }, function () {
      setNet('blocked');
    });
  }
  function setNet(s) {
    state.netStatus = s;
    var el = $('tNet');
    el.querySelector('.dot').className = 'dot ' + (s === 'blocked' ? 'ok' : 'bad');
    el.querySelector('b').textContent = s === 'blocked' ? 'internet blocked' : 'internet NOT blocked';
    el.querySelector('.sm').textContent = s === 'blocked' ? 'Nothing sent' : 'Network open!';
  }

  function runChecks() {
    var list = $('checks');
    list.innerHTML = '<li><span class="ci info">…</span><div><b>Running…</b></div></li>';
    var statusP = NATIVE ? NATIVE.status().then(function (st) { state.nativeStatus = st; return st; }, function () { return null; }) : Promise.resolve(null);
    Promise.all([probeNetwork(), statusP]).then(function (res) {
      var st = res[1];
      var keys = [];
      try { for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e) {}
      var demoN = state.demo && window.LZ_DEMO ? window.LZ_DEMO.items.length : 0;
      var folderN = state.folders.reduce(function (a, f) { return a + f.items.length; }, 0);
      var cacheP = window.caches ? caches.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) { return caches.open(k).then(function (c) { return c.keys(); }); })).then(function (all) {
          return all.reduce(function (a, r) { return a.concat(r.map(function (q) { return new URL(q.url).pathname; })); }, []);
        });
      }).catch(function () { return []; }) : Promise.resolve([]);
      cacheP.then(function (cached) {
        var rows = [
          [state.netStatus === 'blocked', 'Network requests are blocked',
            state.netStatus === 'blocked'
              ? 'A test request just failed because this page\'s policy says <code>connect-src \'none\'</code>. ' + state.blocked + ' blocked attempt' + (state.blocked === 1 ? '' : 's') + ' this session, all of them the test.'
              : 'The test request went through, so the security policy is not active here. Do not search anything private on this copy.'],
          [document.cookie === '', 'No cookies', document.cookie === '' ? 'This page has set no cookies and can read none.' : 'Unexpected cookies are present.'],
          [keys.every(function (k) { return /^lz\.(theme|welcomed|welcomeNever|welcomeAlways|consent)$/.test(k); }), 'Saved on this device: settings only',
            keys.length ? 'Stored: <code>' + keys.map(esc).join('</code>, <code>') + '</code>. Your theme, whether you\'ve seen the tour, and whether you allowed searching this computer. No searches, no paths.' : 'Nothing at all.'],
          NATIVE ? null : [cached.every(function (p) { return /\.(html|css|js|svg|webmanifest)$|\/$/.test(p); }), 'Offline cache holds the app only',
            cached.length ? nf(cached.length) + ' app files, so it works without internet. No results or file data.' : 'No offline cache yet (it fills on the next visit).'],
          [null, 'In memory right now',
            (NATIVE ? nf(state.nativeHits.length) + ' results from this computer + ' : '') + nf(demoN) + ' demo items + ' + nf(folderN) + ' items from ' + state.folders.length + ' folder' + (state.folders.length === 1 ? '' : 's') + '. Gone when you close the tab, press Wipe, or stay idle 5 minutes.'],
          st ? [st.network_libraries === false, 'Desktop core has no networking code',
            'The Rust core contains no network library, and a build check fails if one is ever added. It talks to the tabs extension only through a private local socket that only you can open. Sources: ' +
            st.sources.map(function (s) { return esc(s.label) + ' (' + esc(s.mode) + ')'; }).join(', ') + '.'] : null,
          [null, 'Files read this session', state.reads ? nf(state.reads) + ' preview' + (state.reads === 1 ? '' : 's') + ', ' + fmtSize(state.readBytes) + ' in total. Only when you pressed Preview.' : 'None. LocatorZero has only looked at names and dates.']
        ];
        list.innerHTML = rows.filter(Boolean).map(function (r) {
          var cls = r[0] === null ? 'info' : r[0] ? 'ok' : 'bad', mark = r[0] === null ? 'i' : r[0] ? '✓' : '!';
          return '<li><span class="ci ' + cls + '">' + mark + '</span><div><b>' + r[1] + '</b><span>' + r[2] + '</span></div></li>';
        }).join('');
      });
    });
  }

  // ---------- welcome tour ----------
  var slide = 0, SLIDES = 5;
  function showSlide(i) {
    slide = Math.max(0, Math.min(SLIDES - 1, i));
    document.querySelectorAll('.w-slide').forEach(function (s) { s.hidden = +s.dataset.i !== slide; });
    $('wDots').innerHTML = Array.from({ length: SLIDES }, function (_, k) { return '<i class="' + (k === slide ? 'on' : '') + '"></i>'; }).join('');
    $('wBack').style.visibility = slide ? 'visible' : 'hidden';
    $('wNext').textContent = slide === SLIDES - 1 ? 'Start searching 😊' : 'Next';
  }
  function openWelcome() { showSlide(0); $('wNever').checked = lsGet('lz.welcomeNever') === '1'; if (!$('welcome').open) $('welcome').showModal(); }
  function closeWelcome() {
    lsSet('lz.welcomed', '1'); if ($('welcome').open) $('welcome').close(); $('q').focus();
    if (state.pendingPlans) { var m = state.pendingPlans; state.pendingPlans = null; openPlans(m); }
    else if (state.upgraded) { state.upgraded = false; setTimeout(openWhatsNew, 250); }
    // A moment later, so the key that closed the tour (Escape) cannot also dismiss this question.
    else if (NATIVE && !hasConsent('everywhere') && state.scope.type === 'everywhere') setTimeout(askEverywhere, 250);
  }

  // ---------- theme ----------
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    $('themeBtn').setAttribute('aria-checked', t === 'dark');
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'dark' ? '#0b0d12' : '#f6f7fb');
  }
  function toggleTheme() {
    var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(t); lsSet('lz.theme', t);
  }

  // ---------- sidebar ----------
  function setSidebar(open) {
    var sb = $('sidebar');
    if (open) { sb.hidden = false; requestAnimationFrame(function () { sb.classList.add('open'); }); }
    else { sb.classList.remove('open'); setTimeout(function () { if (!sb.classList.contains('open')) sb.hidden = true; }, 300); }
    $('scrim').hidden = !open;
    $('menuBtn').setAttribute('aria-expanded', open);
    if (open) setTimeout(function () { $('sidebarClose').focus(); }, 50);
  }
  function renderChips() {
    $('kindChips').innerHTML = KINDS.map(function (k) { return '<button class="chip" data-kind="' + k[0] + '" aria-pressed="' + (state.kind === k[0]) + '">' + k[1] + '</button>'; }).join('');
    $('ageChips').innerHTML = AGES.map(function (a) { return '<button class="chip" data-age="' + a[0] + '" aria-pressed="' + (state.age === a[0]) + '">' + a[1] + '</button>'; }).join('');
  }

  function copyPath(it) {
    var text = it.url || it.p;
    var done = function () { toast((it.url ? 'Address' : 'Path') + ' copied 📋'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast(text); });
    else toast(text);
  }

  // ---------- wiring ----------
  function isTyping(e) { var t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }

  // Search runs in the same frame as the keystroke: it costs 1 to 15 ms, cheaper than waiting a frame.
  $('q').addEventListener('input', function () { state.q = $('q').value; state.navigated = false; search(); });
  $('goBtn').addEventListener('click', runSearchNow);
  $('empty').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.try) { $('q').value = state.q = b.dataset.try; search(); $('q').focus(); }
    else if (b.dataset.clearFilters) { state.kind = 'all'; state.age = 'any'; renderChips(); search(); }
    else if (b.dataset.scope) setScope({ type: b.dataset.scope });
    else if (b.dataset.openScope) openScopeMenu();
    else if (b.dataset.choose) chooseFolder();
  });
  $('q').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); state.navigated = true; select(state.sel + 1, true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); state.navigated = true; select(state.sel - 1, true); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      // Enter after moving with the arrow keys opens that result; otherwise it confirms the search.
      if (state.navigated && state.sel >= 0) { var it = state.results[state.sel]; if (canPreview(it)) openPreview(it); }
      else runSearchNow();
    }
    else if (e.key === 'Escape' && !$('preview').hidden) { e.preventDefault(); e.stopPropagation(); closePreview(); }
  });

  $('results').addEventListener('click', function (e) {
    var li = e.target.closest('.r'); if (!li) return;
    var i = +li.dataset.i, it = state.results[i], act = e.target.closest('[data-act]');
    select(i);
    if (act && act.dataset.act === 'preview') openPreview(it);
    else if (act && act.dataset.act === 'copy') copyPath(it);
    else if (act && (act.dataset.act === 'reveal' || act.dataset.act === 'open')) handoff(it);
  });
  $('results').addEventListener('dblclick', function (e) {
    var li = e.target.closest('.r'); if (li) { var it = state.results[+li.dataset.i]; if (canPreview(it)) openPreview(it); }
  });
  $('moreBtn').addEventListener('click', function () { state.shown = Math.min(state.results.length, state.shown + PAGE); renderList(); });

  function mapActivate(e) {
    var t = e.target.closest('.node.toggle');
    if (t) {
      var key = t.getAttribute('data-key');
      state.mapToggle[key] = t.getAttribute('aria-expanded') !== 'true';
      renderMap();
      var again = document.querySelector('#map .node.toggle[data-key="' + CSS.escape(key) + '"]');
      if (again && e.type === 'keydown') again.focus();
      return;
    }
    var g = e.target.closest('.node.leaf'); if (!g) return;
    var i = +g.getAttribute('data-i'); state.sel = i; openPreview(state.results[i]);
  }
  $('map').addEventListener('click', mapActivate);
  $('map').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mapActivate(e); } });

  $('tabList').addEventListener('click', function () { setTab('list'); });
  $('tabMap').addEventListener('click', function () { setTab('map'); });
  document.querySelector('.tabs').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setTab(state.tab === 'list' ? 'map' : 'list'); (state.tab === 'list' ? $('tabList') : $('tabMap')).focus(); }
  });

  $('pvClose').addEventListener('click', closePreview);
  $('pvCopy').addEventListener('click', function () { if (state.openItem) copyPath(state.openItem); });
  $('pvReveal').addEventListener('click', function () { if (state.openItem) handoff(state.openItem); });
  $('nativeSources').addEventListener('click', function (e) {
    if (e.target.id === 'setupTabs') {
      NATIVE.setupTabs().then(function (r) {
        $('tabsHelp').innerHTML = '<p class="small">Registered with ' + esc(r.browsers.join(', ')) + ' ✅ Now add the extension:</p>' +
          '<ol class="small steps"><li>Chrome, Edge, Brave: open <code>chrome://extensions</code>, turn on Developer mode, choose <b>Load unpacked</b>.</li>' +
          '<li>Firefox: open <code>about:debugging</code>, This Firefox, <b>Load Temporary Add-on</b>, pick <code>manifest.json</code>.</li></ol>' +
          (r.extension_dir ? '<button class="btn btn-ghost wide" id="showExt" data-dir="' + esc(r.extension_dir) + '">Show the extension folder</button>' : '');
      }, function (err) { toast(String(err)); });
    } else if (e.target.id === 'showExt') {
      NATIVE.reveal(e.target.dataset.dir + '/manifest.json', null).catch(function (err) { toast(String(err)); });
    }
  });
  $('plansSide').addEventListener('click', function () { openPlans(); });
  applyBinNames();
  $('cleanSide').addEventListener('click', openClean);
  $('whatsNewBtn').addEventListener('click', openWhatsNew);
  $('wnClose').addEventListener('click', function () { $('whatsNew').close(); });
  $('wnOk').addEventListener('click', function () { $('whatsNew').close(); });
  $('wnTry').addEventListener('click', function () { $('whatsNew').close(); openClean(); });
  $('whatsNew').addEventListener('close', function () { if (!$('clean').open) afterIntro(); });
  $('aboutSource').addEventListener('click', function (e) { e.preventDefault(); openExternal(e.currentTarget.href); });
  $('clClose').addEventListener('click', function () { $('clean').close(); });
  $('clPlaces').addEventListener('click', function (e) {
    var b = e.target.closest('.cl-place'); if (!b) return;
    var id = b.dataset.place;
    if (id === 'demo') return runDemoScan();
    if (id === 'pick') return NATIVE.pickFolder().then(function (place) { if (place) askCleanConsent(place); }, function (err) { toast('Could not open the folder picker: ' + err); });
    askCleanConsent(CL.places[+id]);
  });
  $('clStop').addEventListener('click', stopScan);
  $('clAgain').addEventListener('click', function () { CL.scan = null; CL.sel = {}; showClean('start'); renderCleanPlaces(); });
  $('clTabDup').addEventListener('click', function () { setCleanTab('dup'); });
  $('clTabMap').addEventListener('click', function () { setCleanTab('map'); });
  $('clTabBig').addEventListener('click', function () { setCleanTab('big'); });
  ['clDup', 'clBig'].forEach(function (id) {
    $(id).addEventListener('change', function (e) {
      var t = e.target; if (!t.dataset || !t.dataset.p) return;
      if (!toggleSel(t.dataset.p, t.checked)) t.checked = false;
      renderClean();
    });
  });
  function clMapToggle(e) {
    var g = e.target.closest && e.target.closest('#clMap .leaf'); if (!g) return;
    if (e.type === 'keydown') { if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); }
    var p = g.getAttribute('data-p');
    toggleSel(p, !CL.sel[p]); renderClean();
    var again = document.querySelector('#clMap .leaf[data-p="' + (window.CSS && CSS.escape ? CSS.escape(p) : p) + '"]'); if (again) again.focus();
  }
  $('clMap').addEventListener('click', clMapToggle);
  $('clMap').addEventListener('keydown', clMapToggle);
  $('clAuto').addEventListener('click', autoTick);
  $('clGo').addEventListener('click', confirmClean);
  $('ccNo').addEventListener('click', function () { $('clConfirm').close(); });
  $('ccYes').addEventListener('click', function () { $('clConfirm').close(); doClean(); });
  $('pClose').addEventListener('click', function () { $('plans').close(); });
  $('plans').addEventListener('click', function (e) { if (e.target === $('plans')) $('plans').close(); });
  $('pActivate').addEventListener('click', activateKey);
  renderStore();
  document.querySelector('#plans .p-grid').addEventListener('click', function (e) {
    var b = e.target.closest('.p-buy');
    if (b && STORE.live && STORE.checkout[b.dataset.plan]) openExternal(STORE.checkout[b.dataset.plan]);
  });
  $('pGetKey').addEventListener('click', function (e) { e.preventDefault(); openExternal(e.currentTarget.href); });
  $('pKey').addEventListener('keydown', function (e) { if (e.key === 'Enter') activateKey(); });
  $('licBox').addEventListener('click', function (e) {
    if (e.target.id === 'licEnter') { openPlans(state.licence && state.licence.state !== 'trial' ? (state.licence.state === 'expired' ? 'expired' : 'ended') : null); setTimeout(function () { $('pKey').focus(); }, 50); }
    if (e.target.id === 'licRemove') NATIVE.licence.remove().then(function (st) { state.licence = st; renderLicence(); toast('Licence key removed from this computer.'); refreshNative(); });
  });
  $('nativeSources').addEventListener('change', function (e) {
    var id = e.target.dataset.src; if (!id) return;
    state.native[id] = e.target.checked; refreshNative();
  });

  $('addFolderSide').addEventListener('click', chooseFolder);
  $('verifyNote').addEventListener('click', function () { $('verifyBtn').click(); });
  $('scopeBtn').addEventListener('click', function () { if ($('scopeMenu').hidden) openScopeMenu(); else closeScopeMenu(); });
  $('scopeMenu').addEventListener('click', function (e) {
    var b = e.target.closest('.scope-item'); if (!b) return;
    closeScopeMenu();
    if (b.dataset.choose) return chooseFolder();
    if (b.dataset.place) return choosePlace(state.menuPlaces[+b.dataset.place]);
    if (b.dataset.folder) return setScope({ type: 'folder', id: +b.dataset.folder });
    if (b.dataset.scope === 'demo' && !state.demo) { state.demo = true; $('srcDemo').checked = true; }
    setScope({ type: b.dataset.scope });
  });
  $('scopeMenu').addEventListener('keydown', function (e) {
    var items = Array.from($('scopeMenu').querySelectorAll('.scope-item')), i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
    else if (e.key === 'Escape') { e.stopPropagation(); closeScopeMenu(); $('scopeBtn').focus(); }
  });
  document.addEventListener('click', function (e) {
    if (!$('scopeMenu').hidden && !e.target.closest('#scopeMenu, #scopeBtn')) closeScopeMenu();
  });
  $('scopeLine').addEventListener('click', function (e) {
    var b = e.target.closest('[data-scope], [data-consent]'); if (!b) return;
    if (b.dataset.consent) askEverywhere(); else setScope({ type: b.dataset.scope });
  });
  $('dirInput').addEventListener('change', function () { addFromInput(Array.from($('dirInput').files)); $('dirInput').value = ''; });
  $('tryDemo').addEventListener('click', function () {
    if (!state.demo) { state.demo = true; $('srcDemo').checked = true; }
    $('q').value = 'budget'; state.q = 'budget'; search(); $('q').focus();
  });
  $('folderList').addEventListener('click', function (e) { var b = e.target.closest('button[data-id]'); if (b) removeFolder(+b.dataset.id); });
  $('srcDemo').addEventListener('change', function () { state.demo = $('srcDemo').checked; if (state.openItem && state.openItem.demo) closePreview(); scheduleSearch(); });
  $('optHidden').addEventListener('change', function () { state.includeHidden = $('optHidden').checked; toast('Applies to folders you add from now on.'); });
  $('kindChips').addEventListener('click', function (e) { var b = e.target.closest('[data-kind]'); if (b) { state.kind = b.dataset.kind; renderChips(); scheduleSearch(); } });
  $('ageChips').addEventListener('click', function (e) { var b = e.target.closest('[data-age]'); if (b) { state.age = b.dataset.age; renderChips(); scheduleSearch(); } });
  $('recentList').addEventListener('click', function (e) { var b = e.target.closest('[data-q]'); if (b) { $('q').value = state.q = b.dataset.q; search(); setSidebar(false); $('q').focus(); } });
  $('wipeNow').addEventListener('click', function () { wipe(); setSidebar(false); });

  $('menuBtn').addEventListener('click', function () { setSidebar(true); });
  $('sidebarClose').addEventListener('click', function () { setSidebar(false); });
  $('scrim').addEventListener('click', function () { setSidebar(false); });
  $('themeBtn').addEventListener('click', toggleTheme);
  $('helpBtn').addEventListener('click', openWelcome);

  $('wNext').addEventListener('click', function () { if (slide === SLIDES - 1) closeWelcome(); else showSlide(slide + 1); });
  $('wBack').addEventListener('click', function () { showSlide(slide - 1); });
  $('wSkip').addEventListener('click', closeWelcome);
  $('wStart').addEventListener('click', closeWelcome);
  $('wClean').addEventListener('click', function () { lsSet('lz.welcomed', '1'); $('welcome').close(); openClean(); });
  $('wFolder').addEventListener('click', function () { closeWelcome(); chooseFolderWeb(); });
  $('wTry').addEventListener('click', function () { closeWelcome(); $('tryDemo').click(); });
  $('wNever').addEventListener('change', function () { lsSet('lz.welcomeNever', $('wNever').checked ? '1' : '0'); });
  $('welcome').addEventListener('cancel', function (e) { e.preventDefault(); closeWelcome(); });
  $('welcome').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') showSlide(slide + 1);
    else if (e.key === 'ArrowLeft') showSlide(slide - 1);
  });

  function openVerify() { setSidebar(false); $('verify').showModal(); runChecks(); }
  $('verifyBtn').addEventListener('click', openVerify);
  $('verifySide').addEventListener('click', openVerify);
  $('vClose').addEventListener('click', function () { $('verify').close(); });
  [$('welcome'), $('verify')].forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) { if (d === $('welcome')) closeWelcome(); else d.close(); } });
  });

  document.addEventListener('keydown', function (e) {
    markActive();
    if ($('welcome').open || $('verify').open || $('plans').open || $('consent').open) return;
    if (e.key === 'Escape') {
      if (!$('preview').hidden) closePreview();
      else if ($('sidebar').classList.contains('open')) setSidebar(false);
      else if (state.q) { $('q').value = state.q = ''; search(); $('q').focus(); }
      return;
    }
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); $('q').focus(); $('q').select(); }
    else if (e.key === 's' || e.key === 'S') setSidebar(!$('sidebar').classList.contains('open'));
    else if (e.key === 't' || e.key === 'T') toggleTheme();
    else if (e.key === '?') openWelcome();
    else if (e.key === '1' && state.q) setTab('list');
    else if (e.key === '2' && state.q) setTab('map');
  });
  ['pointerdown', 'input', 'wheel'].forEach(function (ev) { document.addEventListener(ev, markActive, { passive: true }); });
  window.addEventListener('scroll', function () { document.querySelector('.topbar').classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });
  window.addEventListener('resize', placeInk);

  // ---------- start ----------
  if (NATIVE) {
    state.demo = false; $('srcDemo').checked = false;
    NATIVE.status().then(function (st) { state.nativeStatus = st; renderNativeSources(); renderAbout(); }, function () {});
    refreshLicence();
  }
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
  renderChips(); renderFolders(); renderRecent(); render();
  requestAnimationFrame(placeInk);
  probeNetwork();
  setInterval(idleTick, 15000); idleTick();
  // The tour opens on every load, refreshes included, unless the visitor ticked "Don't show this at start".
  renderAbout();
  // Decided once per load, before the tour marks this visitor as welcomed.
  state.upgraded = updatedSinceLastVisit();
  if (!state.upgraded) lsSet('lz.seenVersion', LZ_VERSION);
  if (lsGet('lz.welcomeNever') !== '1') openWelcome();
  else if (state.upgraded) { state.upgraded = false; openWhatsNew(); }
  else if (NATIVE && !hasConsent('everywhere')) setTimeout(function () { if (!$('plans').open) askEverywhere(); }, 300);
  else $('q').focus();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  window.__lz = { state: state, search: search, wipe: wipe, idleTick: idleTick, prep: prep }; // for the end-to-end tests
})();
