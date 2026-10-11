// A made-up computer, generated deterministically, so a first-time visitor can search before granting any access.
// None of these paths exist anywhere. Every item is flagged demo: true and the UI labels it.
(function () {
  'use strict';

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var r = rng(20261008);
  function pick(a) { return a[Math.floor(r() * a.length)]; }
  var NOW = Date.UTC(2026, 9, 8, 9, 30);
  var DAY = 864e5;
  function ago(maxDays) { return NOW - Math.floor(Math.pow(r(), 2.2) * maxDays * DAY) - Math.floor(r() * DAY); }

  var SOURCES = {
    local: 'Local disk', external: 'External drive', network: 'Network share',
    cloud: 'Cloud sync', history: 'Browser history', tabs: 'Open tabs', proc: 'Processes'
  };

  var topics = ['budget', 'invoice', 'roadmap', 'contract', 'onboarding', 'quarterly-report', 'tax-return', 'resume',
    'meeting-notes', 'design-review', 'pitch-deck', 'travel', 'insurance', 'lease', 'payroll', 'research', 'thesis',
    'wedding', 'recipes', 'passport-scan', 'receipts', 'project-atlas', 'kickoff', 'retro', 'proposal', 'brand-guide'];
  var years = ['2023', '2024', '2025', '2026'];
  var ext = {
    doc: ['pdf', 'docx', 'md', 'txt', 'pages', 'odt'], data: ['xlsx', 'csv', 'numbers', 'json', 'sqlite'],
    img: ['png', 'jpg', 'heic', 'svg', 'webp'], media: ['mp4', 'mov', 'mp3', 'wav', 'm4a'],
    code: ['js', 'ts', 'py', 'rs', 'go', 'html', 'css', 'sh'], arch: ['zip', 'tar.gz', '7z', 'dmg']
  };
  var kinds = ['doc', 'doc', 'doc', 'data', 'data', 'img', 'img', 'media', 'code', 'arch'];
  var sizeBy = { doc: 4e5, data: 9e5, img: 4e6, media: 2e8, code: 2e4, arch: 6e7 };

  var roots = {
    local: [
      ['Users', 'alex', 'Documents'], ['Users', 'alex', 'Documents', 'Finance'], ['Users', 'alex', 'Documents', 'Work', 'Clients'],
      ['Users', 'alex', 'Downloads'], ['Users', 'alex', 'Desktop'], ['Users', 'alex', 'Pictures', 'Screenshots'],
      ['Users', 'alex', 'Projects', 'atlas', 'src'], ['Users', 'alex', 'Projects', 'atlas', 'docs'], ['Users', 'alex', 'Music'],
      ['Users', 'alex', 'Documents', 'Personal', 'Home']
    ],
    external: [['Volumes', 'BACKUP-2TB', 'Archive', '2024'], ['Volumes', 'BACKUP-2TB', 'Photos', 'Exports'], ['Volumes', 'USB-STICK', 'Transfer']],
    network: [['Shares', 'finance-nas', 'Team', 'Reports'], ['Shares', 'finance-nas', 'Team', 'Templates'], ['Shares', 'design', 'Assets']],
    cloud: [['Cloud', 'Drive', 'Shared with me'], ['Cloud', 'Drive', 'My files', 'Family'], ['Cloud', 'Docs sync', 'Work']]
  };
  var weights = { local: 0.62, external: 0.14, network: 0.12, cloud: 0.12 };

  function fname(k) {
    var t = pick(topics), e = pick(ext[k]);
    var style = r();
    if (k === 'code') return pick(['index', 'utils', 'search', 'budget-calc', 'parser', 'main', 'config', 'report']) + '.' + e;
    if (k === 'img' && style < .5) return 'IMG_' + (1000 + Math.floor(r() * 9000)) + '.' + e;
    if (style < .3) return t.replace(/(^|-)(\w)/g, function (m, d, c) { return (d ? '_' : '') + c.toUpperCase(); }) + '_' + pick(years) + '.' + e;
    if (style < .6) return t + '-' + pick(years) + (r() < .3 ? '-v' + (1 + Math.floor(r() * 4)) : '') + '.' + e;
    if (style < .8) return t + (r() < .5 ? ' (final)' : ' copy') + '.' + e;
    return pick(years) + '-' + String(1 + Math.floor(r() * 12)).padStart(2, '0') + ' ' + t.replace(/-/g, ' ') + '.' + e;
  }

  var items = [];
  function add(src, segs, name, kind, size, t) {
    items.push({ n: name, p: segs.concat(name).join('/'), s: src, src: SOURCES[src], k: kind, z: size, t: t, demo: true });
  }

  var src;
  for (var i = 0; i < 2600; i++) {
    var x = r(), acc = 0;
    for (src in weights) { acc += weights[src]; if (x <= acc) break; }
    var k = pick(kinds);
    add(src, pick(roots[src]), fname(k), k, Math.floor(sizeBy[k] * (0.05 + r() * 1.6)), ago(900));
  }

  // A few sure hits so "budget" tells a story across every lane.
  add('local', ['Users', 'alex', 'Documents', 'Finance'], 'Budget_2026.xlsx', 'data', 182344, NOW - 2 * DAY);
  add('local', ['Users', 'alex', 'Downloads'], 'Budget_2026 (1).xlsx', 'data', 181002, NOW - 9 * DAY);
  add('external', ['Volumes', 'BACKUP-2TB', 'Archive', '2024'], 'Budget_2026.xlsx', 'data', 176310, NOW - 120 * DAY);
  add('network', ['Shares', 'finance-nas', 'Team', 'Reports'], 'Budget_2026_team.xlsx', 'data', 240512, NOW - 4 * DAY);
  add('cloud', ['Cloud', 'Drive', 'Shared with me'], 'Budget 2026 draft.xlsx', 'data', 151201, NOW - 30 * DAY);

  var sites = [
    ['docs.example.com', 'Budget 2026 – shared sheet'], ['mail.example.com', 'Inbox – invoice reminders'],
    ['wiki.example.org', 'Project Atlas roadmap'], ['bank.example', 'Statements – October'], ['news.example', 'Morning briefing'],
    ['maps.example', 'Directions to the office'], ['shop.example', 'Order #4471 receipt'], ['learn.example', 'Rust ownership explained'],
    ['tax.example.gov', 'Tax return checklist'], ['travel.example', 'Flight booking – Lisbon']
  ];
  var browsers = [['Chrome', 'Work profile'], ['Firefox', 'default-release'], ['Edge', 'Personal'], ['Safari', 'Default']];
  sites.forEach(function (s) {
    var b = pick(browsers);
    add('history', [b[0], b[1], s[0]], s[1], 'web', 0, ago(60));
    if (r() < .5) { var b2 = pick(browsers); add('tabs', [b2[0], 'Window 1', s[0]], s[1], 'web', 0, NOW - Math.floor(r() * 3 * 36e5)); }
  });
  for (var h = 0; h < 160; h++) {
    var site = pick(sites), bb = pick(browsers);
    add('history', [bb[0], bb[1], site[0]], pick(topics).replace(/-/g, ' ') + ' – ' + site[0], 'web', 0, ago(180));
  }

  [['Code Helper', '/Applications/Code.app'], ['Spreadsheet', '/Applications/Spreadsheet.app'], ['Terminal', '/System/Applications/Terminal.app'],
   ['syncd', '/usr/libexec/syncd'], ['Photos', '/System/Applications/Photos.app'], ['budget-sync', '/Users/alex/Projects/atlas/bin/budget-sync']]
    .forEach(function (p) { add('proc', ['alex'], p[0] + ' · pid ' + (300 + Math.floor(r() * 9000)), 'proc', 0, NOW - Math.floor(r() * 5 * 36e5)); });

  window.LZ_DEMO = { items: items, sources: SOURCES, now: NOW };
})();
