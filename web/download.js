// Download page: lists the installers from downloads/manifest.js, recommends one for this system, and explains the
// one-time warning unsigned installers get. No network requests: everything comes from same-origin scripts.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var M = window.LZ_DOWNLOADS;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mb(b) { return (b / 1048576).toFixed(1) + ' MB'; }

  // ---- theme, shared with the app ----
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    $('themeBtn').setAttribute('aria-checked', t === 'dark');
  }
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
  $('themeBtn').addEventListener('click', function () {
    var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(t);
    try { localStorage.setItem('lz.theme', t); } catch (e) {}
  });

  // ---- which system is this? ----
  function detect() {
    var p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '').toLowerCase();
    var ua = navigator.userAgent.toLowerCase();
    if (/android|iphone|ipad/.test(ua)) return 'mobile';
    if (p.indexOf('win') >= 0 || ua.indexOf('windows') >= 0) return 'windows';
    if (p.indexOf('mac') >= 0 || ua.indexOf('mac os') >= 0) return 'mac';
    if (p.indexOf('linux') >= 0 || ua.indexOf('linux') >= 0) return 'linux';
    return 'other';
  }
  var os = detect();
  var OS_NAME = { windows: 'Windows', mac: 'Mac', linux: 'Linux' };
  var FIRST_ID = { windows: 'exe', mac: 'arm', linux: 'deb' };

  var HOWTO = {
    exe: 'Run the installer. If Windows shows “Windows protected your PC”, choose <b>More info</b>, then <b>Run anyway</b>.',
    msi: 'Install with a double-click, or silently: <code>msiexec /i LocatorZero_*.msi /qn</code>. SmartScreen may ask once: <b>More info</b>, then <b>Run anyway</b>.',
    arm: 'Open the .dmg and drag LocatorZero to Applications. The first time, macOS blocks it: open <b>System Settings → Privacy &amp; Security</b> and choose <b>Open Anyway</b>.',
    intel: 'Open the .dmg and drag LocatorZero to Applications. The first time, macOS blocks it: open <b>System Settings → Privacy &amp; Security</b> and choose <b>Open Anyway</b>.',
    deb: 'In a terminal: <code>sudo apt install ./LocatorZero_*.deb</code>, then open LocatorZero from your apps menu.',
    rpm: 'In a terminal: <code>sudo dnf install ./LocatorZero-*.rpm</code> (Fedora) or <code>sudo zypper install ./LocatorZero-*.rpm</code> (openSUSE).'
  };

  if (!M || !M.files || !M.files.length) {
    $('dlPrimary').innerHTML = '<p class="dl-wait">The installers are being prepared. Please check back soon, or <a href="./">try LocatorZero in your browser</a> now.</p>';
    $('dlGrid').hidden = true;
    return;
  }

  // ---- recommended download ----
  var pick = M.files.filter(function (f) { return f.os === os && f.id === FIRST_ID[os]; })[0];
  if (pick) {
    var alt = os === 'mac' ? M.files.filter(function (f) { return f.id === 'intel'; })[0] : null;
    $('dlPrimary').innerHTML =
      '<a class="btn btn-primary dl-big" id="dlRecommended" href="downloads/' + encodeURIComponent(pick.file) + '" download>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>' +
        'Download for ' + OS_NAME[os] + '</a>' +
      '<p class="dl-pick">' + esc(pick.title) + ' · ' + esc(pick.note) + ' · ' + mb(pick.bytes) +
        (alt ? ' · <a href="downloads/' + encodeURIComponent(alt.file) + '" download>Intel Mac instead</a>' : '') + '</p>' +
      '<p class="dl-how small">' + HOWTO[pick.id] + '</p>';
  } else {
    $('dlPrimary').innerHTML = os === 'mobile'
      ? '<p class="dl-wait">LocatorZero runs on Windows, macOS and Linux. Open this page on your computer to download it, or <a href="./">try the browser version</a> here.</p>'
      : '<p class="dl-wait">Choose your system below.</p>';
  }
  $('dlMeta').textContent = 'Version ' + M.version + ' · built ' + M.built + (M.commit ? ' from commit ' + M.commit : '');

  // ---- all downloads ----
  var groups = [['windows', 'Windows', '🪟'], ['mac', 'macOS', '🍎'], ['linux', 'Linux', '🐧']];
  $('dlGrid').innerHTML = groups.map(function (g) {
    var files = M.files.filter(function (f) { return f.os === g[0]; });
    if (!files.length) return '';
    return '<div class="dl-card' + (g[0] === os ? ' dl-mine' : '') + '"><h2>' + g[2] + ' ' + g[1] + (g[0] === os ? ' <span class="dl-tag">Your system</span>' : '') + '</h2>' +
      files.map(function (f) {
        return '<div class="dl-file">' +
          '<div class="dl-file-head"><div><b>' + esc(f.title) + '</b><small>' + esc(f.note) + ' · ' + mb(f.bytes) + '</small></div>' +
          '<a class="btn btn-soft" href="downloads/' + encodeURIComponent(f.file) + '" download>Download</a></div>' +
          '<p class="dl-how small">' + (HOWTO[f.id] || '') + '</p>' +
          '<div class="dl-sha"><span class="small muted">SHA-256</span><code>' + esc(f.sha256) + '</code>' +
          '<button class="link-btn small" data-copy="' + esc(f.sha256) + '">Copy</button></div>' +
          '</div>';
      }).join('') +
      (g[0] === 'linux' && !M.files.some(function (f) { return f.id === 'rpm'; }) ? '<p class="small muted">An .rpm for Fedora and openSUSE is coming next.</p>' : '') +
      (g[0] === 'linux' ? '<p class="small muted">Other distributions: an AppImage is coming. It is too large for this site for now.</p>' : '') +
      '</div>';
  }).join('');

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]'); if (!b) return;
    var done = function () { b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, function () {}); else done();
  });
})();
