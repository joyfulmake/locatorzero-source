// End-to-end checks for the web app in headless Chromium, against a server that applies the real _headers.
// Run: npm test   (CHROMIUM=/path/to/chrome to override the browser, BASE_URL=https://… to test a deployment)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
fs.rmSync(out, { recursive: true, force: true });
const fx = path.join(out, 'fixture', 'MyFolder');
for (const d of ['notes', 'pics', '.git', 'node_modules/pkg', 'deep/a/b/c']) fs.mkdirSync(path.join(fx, d), { recursive: true });
fs.writeFileSync(path.join(fx, 'notes', 'meeting-notes.txt'), 'Secret plan: ship LocatorZero on Friday.\n');
fs.writeFileSync(path.join(fx, 'notes', 'big-log.txt'), 'x'.repeat(200000));
fs.writeFileSync(path.join(fx, 'pics', 'logo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
fs.writeFileSync(path.join(fx, '.git', 'config'), '[core]');
fs.writeFileSync(path.join(fx, 'node_modules', 'pkg', 'index.js'), 'module.exports=1');
fs.writeFileSync(path.join(fx, 'deep', 'a', 'b', 'c', 'budget-final.csv'), 'a,b\n1,2\n');
fs.writeFileSync(path.join(fx, 'program.bin'), Buffer.from([0, 1, 2, 3, 0, 255, 65, 66]));

let server, base = process.env.BASE_URL;
if (!base) { server = await start(0); base = 'http://127.0.0.1:' + server.address().port + '/'; }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });

let failures = 0, passes = 0;
async function test(name, fn) {
  try { await fn(); passes++; console.log('  ✓ ' + name); }
  catch (e) { failures++; console.log('  ✗ ' + name + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 3).join('\n      ')); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
async function closeTour(pg) {
  await pg.waitForSelector('#welcome[open]');
  await pg.keyboard.press('Escape');
  await pg.waitForFunction(() => !document.querySelector('#welcome').open);
}
async function type(pg, q) { await pg.fill('#q', q); await pg.waitForFunction(q => window.__lz.state.searched === q, q); }

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [], requests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/__lz_probe__|Content Security Policy|connect-src/.test(m.text())) errors.push(m.text()); });
page.on('request', r => requests.push(r.url()));

console.log('LocatorZero e2e against ' + base);

await test('serves a strict CSP that blocks all network connections', async () => {
  const res = await page.goto(base);
  const csp = res.headers()['content-security-policy'] || '';
  assert(/connect-src 'none'/.test(csp), 'CSP header missing connect-src none: ' + csp);
  assert(/frame-ancestors 'none'/.test(csp), 'no frame-ancestors');
  assert(res.headers()['referrer-policy'] === 'no-referrer');
});

await test('service worker gets its own policy, not the page one joined to it', async () => {
  const res = await page.request.get(base + 'sw.js');
  const csp = res.headers()['content-security-policy'] || '';
  assert(csp === "default-src 'none'; connect-src 'self'", 'sw.js CSP is: ' + csp);
});

await test('welcome tour shows on first visit and walks through 5 slides', async () => {
  await page.waitForSelector('#welcome[open]');
  assert((await page.textContent('#wTitle')).includes('Type any part of its name'));
  for (let i = 0; i < 4; i++) await page.click('#wNext');
  assert((await page.textContent('#wNext')).includes('Start searching'));
  await page.click('#wNext');
  await page.waitForFunction(() => !document.querySelector('#welcome').open);
});

await test('trust strip proves the network is blocked', async () => {
  await page.waitForFunction(() => document.querySelector('#tNet b').textContent === 'internet blocked');
  assert(await page.isVisible('#trust'));
});

await test('welcome opens on every reload, until "Don\'t show this at start" is ticked', async () => {
  await page.reload();
  await page.waitForSelector('#welcome[open]');
  await page.check('#wNever');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForTimeout(400);
  assert(!(await page.$('#welcome[open]')), 'welcome showed despite the opt-out');
  await page.click('#helpBtn');
  await page.waitForSelector('#welcome[open]');
  await page.uncheck('#wNever');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#welcome').open);
  await page.reload();
  await page.waitForSelector('#welcome[open]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#welcome').open);
});

await test('no matches: says the search finished, where it looked, and what to try', async () => {
  await type(page, 'zzqqxx');
  await page.waitForSelector('#empty:not([hidden]) h3');
  assert((await page.textContent('#empty h3')).includes('No matches for “zzqqxx”'));
  assert((await page.textContent('#empty')).includes('The search finished'));
  assert((await page.textContent('#stat')).includes('Search complete'));
  await page.click('#tabMap');
  await page.waitForSelector('#map .miss-dot');
  const lanes = await page.$$eval('#map .lane-label', ns => ns.map(n => n.textContent));
  assert(lanes.length >= 7 && lanes.some(l => l.startsWith('Local disk')), 'coverage map lanes: ' + lanes);
  assert((await page.textContent('#mapNote')).includes('None of them has a match'));
  await page.click('#tabList');
  await page.click('#empty [data-try="zzqqx"]');
  assert(await page.inputValue('#q') === 'zzqqx', 'fewer-letters suggestion did not apply');
  await type(page, 'zzqqx budget');
  await page.click('#empty [data-try="budget"]');
  await page.waitForFunction(() => window.__lz.state.results.length > 0);
  await type(page, '');
});

await test('Search button and Enter confirm the search; Enter previews only after arrow keys', async () => {
  await page.fill('#q', 'budget');
  await page.click('#goBtn');
  await page.waitForFunction(() => window.__lz.state.searched === 'budget');
  assert((await page.textContent('#stat')).includes('Search complete'));
  await page.focus('#q'); await page.keyboard.press('Enter');
  assert(await page.isHidden('#preview'), 'Enter without arrows should not open a preview');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForSelector('#preview:not([hidden])');
  await page.click('#pvClose');
  await type(page, '');
});

await test('tour ends with a one-click demo search', async () => {
  await page.click('#helpBtn');
  await page.waitForSelector('#welcome[open]');
  for (let i = 0; i < 4; i++) await page.click('#wNext');
  await page.click('#wTry');
  await page.waitForFunction(() => !document.querySelector('#welcome').open && window.__lz.state.searched === 'budget');
  assert(await page.evaluate(() => window.__lz.state.results.length) > 0);
  await type(page, '');
});

await test('Clean up (demo): finds duplicates, keeps one copy of each, maps them, and asks before moving anything', async () => {
  await page.evaluate(() => document.getElementById('cleanSide').click());
  await page.waitForSelector('#clean[open]');
  await page.click('.cl-place[data-place=demo]');
  await page.waitForSelector('#clResults:not([hidden])', { timeout: 10000 });
  assert((await page.textContent('#clSummary')).includes('6 sets of duplicates'), 'summary');
  assert(await page.isDisabled('#clGo'), 'nothing ticked, so nothing can be moved');
  await page.click('#clAuto');
  assert((await page.textContent('#clSel')).startsWith('10 files ticked'), 'every extra copy ticked');
  await page.click('#clTabMap');
  assert(await page.$$eval('#clMap .leaf', l => l.length) === 16, 'map shows every copy');
  await page.click('#clMap .leaf.keep');
  assert((await page.textContent('#toast')).includes('One copy always stays'), 'the last copy cannot be ticked');
  await page.click('#clGo');
  await page.waitForSelector('#clConfirm[open]');
  await page.click('#ccNo');
  assert((await page.textContent('#clSel')).startsWith('10 files'), 'cancel moves nothing');
  await page.click('#clGo'); await page.click('#ccYes');
  await page.waitForFunction(() => document.getElementById('clSummary').textContent.includes('All duplicates cleaned up'));
  await page.click('#clClose');
});

await test('About shows the version, which matches the desktop build, and What\'s new lists this release', async () => {
  const conf = JSON.parse(fs.readFileSync(new URL('../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert((await page.textContent('#aboutVer')) === conf.version, 'LZ_VERSION in app.js must equal tauri.conf.json');
  await page.evaluate(() => document.getElementById('whatsNewBtn').click());
  await page.waitForSelector('#whatsNew[open]');
  assert((await page.textContent('#wnTitle')).includes(conf.version));
  assert((await page.textContent('#wnBody')).includes('Clean up'));
  await page.click('#wnOk');
});

await test('someone who used an earlier version sees What\'s new once; a first-time visitor does not', async () => {
  const c2 = await browser.newContext();
  const p = await c2.newPage();
  await p.goto(base); await p.waitForSelector('#welcome[open]');
  await p.evaluate(() => { localStorage.setItem('lz.seenVersion', '0.1.0'); localStorage.setItem('lz.welcomeNever', '1'); });
  await p.reload(); await p.waitForSelector('#whatsNew[open]');
  await p.click('#wnOk');
  await p.reload(); await p.waitForTimeout(600);
  assert(!(await p.evaluate(() => document.getElementById('whatsNew').open)), 'shown only once');
  await c2.close();
});

await test('the first welcome slide points to Clean up and jumps to its slide', async () => {
  await page.click('#helpBtn');
  await page.waitForSelector('#welcome[open]');
  await page.click('#wNew');
  assert(await page.isVisible('.w-slide[data-i="3"]'), 'Clean up slide shown');
  assert((await page.textContent('.w-slide[data-i="3"]')).includes('Free up space'));
  await page.click('#wSkip');
});

await test('web shows a privacy disclaimer instead of a folder button under the search field', async () => {
  assert(await page.isVisible('#webNote'), 'disclaimer missing');
  const t = await page.textContent('#webNote');
  assert(t.includes('Nothing is uploaded') && t.includes('desktop app'), t);
  assert(!(await page.$('#addFolderHero')), 'old folder button still present');
});

await test('Search in menu lists places, and choosing a folder asks for consent first', async () => {
  await page.click('#scopeBtn');
  await page.waitForSelector('#scopeMenu:not([hidden]) .scope-item');
  const items = await page.$$eval('#scopeMenu .scope-item b', bs => bs.map(b => b.textContent));
  for (const want of ['Everything here', 'Demo computer', 'Choose a folder on this device…']) assert(items.includes(want), 'missing ' + want + ' in ' + items);
  await page.click('#scopeMenu [data-choose]');
  await page.waitForSelector('#consent[open]');
  const c = await page.textContent('#consent');
  assert(c.includes('Never uploads') && c.includes('call this "upload"'), c.slice(0, 200));
  await page.click('#cNo');
  await page.waitForFunction(() => !document.querySelector('#consent').open);
  assert(await page.evaluate(() => window.__lz.state.folders.length) === 0, 'a folder was added without consent');
});

await test('choosing Demo computer narrows the search to it', async () => {
  await page.click('#scopeBtn');
  await page.click('#scopeMenu [data-scope="demo"]');
  assert((await page.textContent('#scopeLabel')) === 'Demo computer');
  await type(page, 'budget');
  assert((await page.textContent('#scopeLine')).includes('only the demo computer'));
  await page.click('#scopeLine [data-scope="all"]');
  assert((await page.textContent('#scopeLabel')) === 'Everything here');
  await type(page, '');
});

const afterLoad = requests.length;

await test('typing searches demo data instantly', async () => {
  await type(page, 'budget');
  await page.waitForSelector('.r');
  const n = await page.evaluate(() => window.__lz.state.results.length);
  assert(n >= 5, 'too few results: ' + n);
  const ms = await page.evaluate(() => window.__lz.state.ms);
  assert(ms < 50, 'search took ' + ms + ' ms');
  assert((await page.textContent('.r .r-name')).toLowerCase().includes('budget'));
  assert((await page.textContent('#stat')).includes('ms'));
});

await test('arrow keys move the selection and Enter opens a preview', async () => {
  await page.focus('#q');
  await page.keyboard.press('ArrowDown');
  assert(await page.getAttribute('#r1', 'aria-selected') === 'true');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#preview:not([hidden]) pre, #preview:not([hidden]) img, #preview:not([hidden]) .pv-msg');
  await page.keyboard.press('Escape');
  assert(await page.isHidden('#preview'));
});

await test('map tab draws lanes and clickable leaves', async () => {
  await page.click('#tabMap');
  await page.waitForSelector('#map .node.leaf');
  const lanes = await page.$$eval('#map .lane-label', ns => ns.map(n => n.textContent));
  for (const l of ['Local disk', 'External drive', 'Network share', 'Cloud sync']) assert(lanes.includes(l), 'missing lane ' + l + ' in ' + lanes);
  await page.click('#map .node.leaf');
  await page.waitForSelector('#preview:not([hidden])');
  await page.click('#pvClose');
  // 131 matches: most folders start closed, and clicking one opens it
  const closed = await page.$$('#map .node.toggle.closed');
  assert(closed.length > 0, 'nothing collapsed');
  const key = await closed[0].getAttribute('data-key');
  const before = await page.$$eval('#map .node.leaf', n => n.length);
  await closed[0].click();
  await page.waitForSelector('#map .node.toggle[data-key="' + key + '"][aria-expanded="true"]');
  assert(await page.$$eval('#map .node.leaf', n => n.length) > before, 'opening a folder showed no more files');
  await page.click('#tabList');
});

await test('adding a real folder indexes it, skipping .git and node_modules', async () => {
  await page.setInputFiles('#dirInput', path.join(out, 'fixture', 'MyFolder'));
  await page.waitForFunction(() => window.__lz.state.folders.length === 1 && window.__lz.state.folders[0].done);
  const paths = await page.evaluate(() => window.__lz.state.folders[0].items.map(i => i.p));
  assert(paths.some(p => p.endsWith('meeting-notes.txt')), 'notes missing');
  assert(!paths.some(p => p.includes('.git') || p.includes('node_modules')), 'hidden dirs indexed');
  assert(paths.some(p => p.endsWith('deep/a/b')), 'intermediate folders missing');
});

await test('preview of a real text file reads its content', async () => {
  await type(page, 'meeting-notes.txt');
  await page.waitForSelector('.r .src-badge:has-text("Your folder")');
  await page.click('.r:has(.src-badge:has-text("Your folder")) [data-act="preview"]');
  await page.waitForSelector('#pvBody pre');
  assert((await page.textContent('#pvBody pre')).includes('Secret plan'));
  assert((await page.textContent('#pvFoot')).includes('Read'));
});

await test('preview stops at 64 KB', async () => {
  await type(page, 'big-log');
  await page.waitForSelector('.r [data-act="preview"]');
  await page.click('.r [data-act="preview"]');
  await page.waitForSelector('#pvBody pre');
  const len = await page.evaluate(() => document.querySelector('#pvBody pre').textContent.replace(/\n\n… preview stops at 64 KB$/, '').length);
  assert(len === 65536, 'read ' + len + ' chars');
  assert((await page.textContent('#pvFoot')).includes('64 KB of 195 KB'), await page.textContent('#pvFoot'));
});

await test('binary files show a hex dump, images render', async () => {
  await type(page, 'program.bin');
  await page.click('.r [data-act="preview"]');
  await page.waitForSelector('#pvBody pre');
  assert((await page.textContent('#pvBody pre')).includes('Binary file'));
  await type(page, 'logo.png');
  await page.click('.r [data-act="preview"]');
  await page.waitForSelector('#pvBody img');
  await page.click('#pvClose');
});

await test('a file deleted after the folder was added disappears on preview', async () => {
  fs.writeFileSync(path.join(fx, 'notes', 'temp-delete-me.txt'), 'bye');
  await page.setInputFiles('#dirInput', path.join(out, 'fixture', 'MyFolder'));
  await page.waitForFunction(() => window.__lz.state.folders.length === 2);
  fs.rmSync(path.join(fx, 'notes', 'temp-delete-me.txt'));
  await type(page, 'temp-delete-me');
  await page.click('.r [data-act="preview"]');
  await page.waitForSelector('#pvBody .pv-msg');
  assert((await page.textContent('#pvBody')).includes('no longer exists'), await page.textContent('#pvBody'));
  await page.waitForFunction(() => window.__lz.state.results.length === 0);
  await page.click('#pvClose');
  await page.evaluate(() => { window.__lz.state.folders.pop(); });
});

await test('no network request was made by searching, mapping or previewing', async () => {
  const extra = requests.slice(afterLoad).filter(u => !u.startsWith('blob:') && !u.startsWith('data:'));
  assert(extra.length === 0, 'unexpected requests: ' + extra.join(', '));
});

await test('sidebar filters narrow results', async () => {
  await type(page, 'a');
  const all = await page.evaluate(() => window.__lz.state.results.length);
  await page.click('#menuBtn');
  await page.waitForSelector('#sidebar.open');
  await page.click('[data-kind="img"]');
  await page.waitForFunction(() => window.__lz.state.kind === 'img' && window.__lz.state.results.every(i => i.k === 'img'));
  const imgs = await page.evaluate(() => window.__lz.state.results.every(i => i.k === 'img') && window.__lz.state.results.length);
  assert(imgs > 0 && imgs < all, 'filter did not narrow: ' + imgs + ' of ' + all);
  await page.click('[data-kind="all"]');
  await page.click('#sidebarClose');
  await page.waitForSelector('#sidebar', { state: 'hidden' });
});

await test('plans window shows the three prices, and the web app says it stays free', async () => {
  await page.click('#menuBtn'); await page.waitForSelector('#sidebar.open');
  await page.click('#plansSide');
  await page.waitForSelector('#plans[open]');
  const txt = await page.textContent('#plans');
  for (const p of ['$3', '$25', '$35', '90 days', 'stays free']) assert(txt.includes(p), 'missing ' + p);
  assert(await page.isHidden('#pKey'), 'key entry should be desktop-only');
  await page.click('#pClose');
});

await test('verify panel runs live checks and all pass', async () => {
  await page.click('#verifyBtn');
  await page.waitForSelector('#checks .ci.ok');
  const bad = await page.$$('#checks .ci.bad');
  assert(bad.length === 0, 'failing checks: ' + (await page.$$eval('#checks li', ls => ls.map(l => l.textContent).join(' | '))));
  await page.click('#vClose');
});

await test('theme toggle switches and persists', async () => {
  const before = await page.getAttribute('html', 'data-theme');
  await page.click('#themeBtn');
  const after = await page.getAttribute('html', 'data-theme');
  assert(before !== after);
  await page.reload();
  assert(await page.getAttribute('html', 'data-theme') === after, 'theme not persisted');
  await closeTour(page);
});

await test('idle for 5 minutes wipes folders and searches', async () => {
  await page.setInputFiles('#dirInput', path.join(out, 'fixture', 'MyFolder'));
  await type(page, 'notes');
  await page.evaluate(() => { window.__lz.state.lastActive = Date.now() - 5 * 60 * 1000 - 1; window.__lz.idleTick(); });
  const s = await page.evaluate(() => ({ f: window.__lz.state.folders.length, q: document.querySelector('#q').value }));
  assert(s.f === 0 && s.q === '', JSON.stringify(s));
});

await test('search stays fast with 300,000 items', async () => {
  const ms = await page.evaluate(() => {
    const lz = window.__lz, items = [];
    for (let i = 0; i < 300000; i++) items.push(lz.prep({ n: 'file-' + i + '.txt', p: 'Big/dir' + (i % 500) + '/file-' + i + '.txt', s: 'folder', src: 'Your folder · Big', k: 'doc', z: i, t: Date.now() - i * 1000 }));
    lz.state.folders.push({ id: 99, name: 'Big', items, done: true });
    const runs = [];
    for (const q of ['file-12', 'dir42 file', 'zzz-none', 'txt']) { document.querySelector('#q').value = lz.state.q = q; lz.search(); runs.push(lz.state.ms); }
    lz.wipe('');
    return runs;
  });
  console.log('      search ms over 300k items: ' + ms.map(m => m.toFixed(1)).join(', '));
  assert(Math.max(...ms) < 150, 'too slow: ' + ms);
});

await test('works offline after the first visit', async () => {
  if (!base.startsWith('http://127.0.0.1') && !base.startsWith('https://')) return;
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await closeTour(page);
  await ctx.setOffline(true);
  await page.reload(); await closeTour(page);
  await type(page, 'budget');
  await page.waitForSelector('.r');
  await ctx.setOffline(false);
});

await test('no inline style attributes (the CSP would silently drop them)', async () => {
  await type(page, 'budget');
  await page.click('#tabMap'); await page.waitForSelector('#map .node.leaf');
  const bad = await page.$$eval('#results [style], #map [style], #map [fill^="var("]', els => els.length);
  await page.click('#tabList');
  const html = await page.$eval('#results', e => e.innerHTML);
  assert(bad === 0 && !/style="/.test(html), bad + ' inline styles found');
});

await test('download page lists every installer with a fingerprint that matches the file', async () => {
  const dl = await ctx.newPage();
  dl.on('pageerror', e => errors.push('download page: ' + e.message));
  const res = await dl.goto(base + 'download.html');
  assert(/connect-src 'none'/.test(res.headers()['content-security-policy'] || ''), 'download page lacks the CSP');
  const m = await dl.evaluate(() => window.LZ_DOWNLOADS);
  if (!m) { await dl.waitForSelector('.dl-wait'); await dl.close(); return; } // nothing staged locally: the page says so
  assert(m.files.length >= 5, 'expected at least 5 installers, got ' + m.files.length);
  for (const os of ['windows', 'mac', 'linux']) assert(m.files.some(f => f.os === os), 'no ' + os + ' installer');
  assert(await dl.isVisible('#dlRecommended'), 'no recommended download');
  assert((await dl.textContent('#dlRecommended')).includes('Linux'), 'headless Linux should be offered the Linux build');
  const cards = await dl.$$eval('.dl-file', n => n.length);
  assert(cards === m.files.length, cards + ' cards for ' + m.files.length + ' files');
  const crypto = await import('node:crypto');
  for (const f of m.files) {
    const r = await dl.request.get(base + 'downloads/' + encodeURIComponent(f.file));
    assert(r.status() === 200, f.file + ' returned ' + r.status());
    assert(/attachment/.test(r.headers()['content-disposition'] || ''), f.file + ' is not served as a download');
    const sum = crypto.createHash('sha256').update(await r.body()).digest('hex');
    assert(sum === f.sha256 && /^[0-9a-f]{64}$/.test(sum), f.file + ' fingerprint mismatch');
  }
  const sig = await dl.request.get(base + 'downloads/SHA256SUMS.txt.asc');
  assert(sig.status() === 200 && (await sig.text()).includes('BEGIN PGP SIGNATURE'), 'checksum signature missing');
  const key = await dl.request.get(base + 'locatorzero-release-key.asc');
  assert(key.status() === 200 && (await key.text()).includes('BEGIN PGP PUBLIC KEY'), 'release key missing');
  assert(await dl.isVisible('.dl-video video'), 'demo video missing');
  const mres = await dl.request.get(base + 'downloads/manifest.js');
  assert(!/attachment/.test(mres.headers()['content-disposition'] || ''), 'manifest.js must load as a script, not download');
  assert((await dl.$$eval('[style]', e => e.length)) === 0, 'inline styles on the download page');
  await dl.close();
});

await test('privacy policy page is online, linked from the app, and under the same policy', async () => {
  const href = await page.getAttribute('.copy a[href="privacy.html"]', 'href');
  assert(href === 'privacy.html', 'footer has no privacy link');
  const pv = await ctx.newPage();
  const res = await pv.goto(base + 'privacy.html');
  assert(res.status() === 200 && /connect-src 'none'/.test(res.headers()['content-security-policy'] || ''));
  const t = await pv.textContent('main');
  for (const want of ['sends nothing from your device', 'Lemon Squeezy', 'Cloudflare', 'first 64 KB']) assert(t.includes(want), 'missing: ' + want);
  await pv.close();
});

await test('installers are never stored in the offline cache', async () => {
  const cached = await page.evaluate(async () => {
    const out = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  assert(!cached.some(p => p.includes('/downloads/')), 'cached: ' + cached.filter(p => p.includes('/downloads/')));
});

await test('web says plainly under the search field what it can and cannot see, also while searching', async () => {
  await page.evaluate(() => window.__lz.wipe(''));
  const t = await page.textContent('#safetyLine');
  assert(/demo computer/.test(t) && /a folder you pick/.test(t) && /nothing leaves this tab/.test(t) && /can't see the rest of your computer/.test(t), t);
  await type(page, 'budget');
  assert(await page.isVisible('#safetyLine'), 'safety line hidden during a search');
});

await test('typed filters narrow results and are named in the scope line', async () => {
  await type(page, 'budget ext:pdf');
  let r = await page.evaluate(() => window.__lz.state.results.map(i => i.n));
  assert(r.length > 0 && r.every(n => /\.pdf$/i.test(n)), 'ext: ' + r.slice(0, 5));
  assert((await page.textContent('#scopeLine')).includes('.pdf'));
  await type(page, 'a size:>1mb');
  r = await page.evaluate(() => window.__lz.state.results.map(i => i.z));
  assert(r.length > 0 && r.every(z => z >= 1048576), 'size: ' + r.slice(0, 5));
  await type(page, 'a type:image');
  r = await page.evaluate(() => window.__lz.state.results.map(i => i.k));
  assert(r.length > 0 && r.every(k => k === 'img'), 'type: ' + r.slice(0, 5));
  await type(page, 'a modified:week');
  r = await page.evaluate(() => window.__lz.state.results.map(i => window.LZ_DEMO.now - i.t));
  assert(r.length > 0 && r.every(d => d <= 7 * 864e5), 'modified: ' + r.slice(0, 5));
  await type(page, 'ext:csv');
  r = await page.evaluate(() => window.__lz.state.results.map(i => i.n));
  assert(r.length > 0 && r.every(n => /\.csv$/i.test(n)), 'a filter alone lists every match');
  await type(page, 'budget size:huge');
  assert(await page.evaluate(() => window.__lz.state.pq.words.includes('size:huge')), 'an unparsable filter stays a word');
});

await test('kind chips show counts that add up, narrow on click, and grouping adds headers', async () => {
  await type(page, 'budget');
  await page.waitForSelector('#facets:not([hidden]) [data-fkind]');
  const counts = await page.$$eval('#facetKinds [data-fkind] em', es => es.map(e => +e.textContent.replace(/\D/g, '')));
  assert(counts[0] === counts.slice(1).reduce((a, b) => a + b, 0), 'All is not the sum: ' + counts);
  const kind = await page.$eval('#facetKinds [data-fkind]:not([data-fkind="all"])', b => b.dataset.fkind);
  await page.click('#facetKinds [data-fkind="' + kind + '"]');
  assert(await page.evaluate(k => window.__lz.state.results.every(i => i.k === k), kind), 'chip did not narrow');
  await page.click('#facetKinds [data-fkind="all"]');
  await page.click('#groupSeg [data-group="kind"]');
  await page.waitForSelector('.r-group');
  const ok = await page.evaluate(() => {
    const ks = window.__lz.state.results.map(i => i.k), seen = new Set();
    for (let i = 0; i < ks.length; i++) { if (i && ks[i] !== ks[i - 1] && seen.has(ks[i])) return false; seen.add(ks[i]); }
    return seen.size === document.querySelectorAll('.r-group').length || document.querySelector('#moreBtn:not([hidden])');
  });
  assert(ok, 'groups are not contiguous, or headers are missing');
  assert(await page.evaluate(() => localStorage.getItem('lz.group')) === 'kind', 'grouping is remembered');
  await page.click('#groupSeg [data-group="folder"]');
  assert((await page.$$('.r-group')).length > 1);
  await page.click('#groupSeg [data-group="none"]');
  assert((await page.$$('.r-group')).length === 0);
});

await test('no matches offers the Recycle Bin and the deleted-file help', async () => {
  await type(page, 'zzqxnothing');
  assert(await page.isVisible('#empty [data-bin]') && await page.isVisible('#empty [data-deleted]'));
});

await test('Recycle Bin (demo): newest first, Restore asks first, then puts it back', async () => {
  await page.fill('#q', ''); await page.evaluate(() => { window.__lz.state.q = ''; window.__lz.search(); });
  await page.click('#scopeBtn');
  await page.click('#scopeMenu [data-bin]');
  await page.waitForSelector('.r-bin');
  const names = await page.$$eval('.r-bin .r-name', es => es.map(e => e.textContent));
  assert(names[0] === 'Budget_2026 (final).xlsx', 'newest first: ' + names.slice(0, 3));
  assert((await page.textContent('.r-bin .r-path')).startsWith('from '), 'shows where it came from');
  assert(!(await page.$('.r-bin [data-act="preview"]')), 'deleted files have no preview');
  await page.click('.r-bin [data-act="restore"]');
  await page.waitForSelector('#restore[open]');
  assert((await page.textContent('#rsWhere')).includes('Documents/Finance'));
  await page.click('#rsNo');
  assert(await page.evaluate(() => window.__lz.state.results.length) === names.length, 'cancel moved nothing');
  await page.click('.r-bin [data-act="restore"]');
  await page.click('#rsYes');
  await page.waitForFunction(n => window.__lz.state.results.length === n - 1, names.length);
  assert((await page.textContent('#toast')).includes('back in Finance'));
  await type(page, 'thesis');
  assert(await page.evaluate(() => window.__lz.state.results.length === 1 && window.__lz.state.results[0].s === 'trash'));
  await page.fill('#q', ''); await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__lz.state.scope.type === 'all');
});

await test('Deleted by mistake? explains each system, Shift+Delete and Ctrl+Shift+Delete, and opens the bin', async () => {
  await page.click('#menuBtn'); await page.waitForSelector('#sidebar.open');
  await page.click('#deletedSide');
  await page.waitForSelector('#deleted[open]');
  await page.click('#deleted [data-os="win"]');
  let t = await page.evaluate(() => document.getElementById('deleted').innerText);
  assert(/Shift\s*\+\s*Delete/.test(t) && /Windows File Recovery/.test(t) && /clears history, cookies and cache/.test(t), t);
  await page.click('#deleted .d-tabs [data-os="mac"]');
  t = await page.evaluate(() => document.getElementById('deleted').innerText);
  assert(/Time Machine/.test(t) && /Put Back/.test(t) && !/Windows File Recovery/.test(t), 'mac tab');
  await page.click('#deleted .d-tabs [data-os="linux"]');
  assert((await page.evaluate(() => document.getElementById('deleted').innerText)).includes('PhotoRec'));
  await page.click('#dSearchBin');
  await page.waitForFunction(() => window.__lz.state.scope.type === 'trash');
  await page.evaluate(() => window.__lz.wipe(''));
});

// The desktop interface, against a stand-in for the Rust core, so its own paths run here too.
await test('desktop: the bin asks first, Restore confirms and explains a refusal, drives show their space, the shortcut is listed', async () => {
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const d = await dctx.newPage();
  const derr = [];
  d.on('pageerror', e => derr.push(e.message));
  await d.addInitScript(() => {
    localStorage.setItem('lz.welcomeNever', '1'); localStorage.setItem('lz.consent', 'everywhere'); localStorage.setItem('lz.seenVersion', '0.3.0');
    addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('native'));
    const ok = v => Promise.resolve(v), calls = window.__calls = [];
    const bin = [
      { n: 'report.docx', p: '/home/u/Documents/report.docx', s: 'trash', src: 'Trash', z: 1200, t: Date.now() - 36e5, id: 'info/report.docx.trashinfo' },
      { n: 'clash.txt', p: '/home/u/clash.txt', s: 'trash', src: 'Trash', z: 5, t: Date.now() - 72e5, id: 'info/clash.txt.trashinfo' }];
    window.LZ_NATIVE = {
      locate: (q, srcs, scope) => { calls.push(['locate', q, srcs, scope]); return ok({ hits: srcs.join() === 'trash' ? bin.filter(h => h.n.includes(q)).map(h => Object.assign({}, h)) : [], ms: 2, errors: [], licence_required: false }); },
      places: () => ok([{ label: 'Your home folder', kind: 'home', path: '/home/u', indexed: true, total: 512e9, free: 120e9, fs: 'ext4' },
        { label: 'USB STICK', kind: 'usb', path: '/media/u/USB STICK', indexed: false, total: 32e9, free: 1e9, fs: 'vfat' }]),
      pickFolder: () => ok(null), placeProgress: () => ok([0, true]), forget: () => ok(), preview: () => ok({ kind: 'none', size: 0, read: 0 }),
      reveal: () => ok(), setupTabs: () => ok({ browsers: [] }), openBin: () => { calls.push(['openBin']); return ok(); },
      status: () => ok({ version: '0.3.0', platform: 'linux', sources: [{ id: 'files', label: 'This computer', available: true, mode: 'system index', degraded: false, note: '' }], network_libraries: false, hotkey: 'Ctrl Shift Space', bin: 'Trash', can_restore: true }),
      restore: ids => { calls.push(['restore', ids]); return /clash/.test(ids[0]) ? Promise.reject('Something called “clash.txt” is already in /home/u. Nothing was overwritten. Rename or move it, then restore again.') : ok(['/home/u/Documents/report.docx']); },
      onFocusRequest: fn => { window.__focusRequest = fn; },
      licence: { status: () => ok({ state: 'trial', trial_days_left: 80, allowed: true }), activate: () => ok({}), remove: () => ok({}) }
    };
  });
  await d.goto(base);
  await d.waitForFunction(() => document.querySelector('.hotkey-row') && !document.querySelector('.hotkey-row').hidden);
  assert((await d.textContent('#hotkeyKeys')).replace(/\s/g, '') === 'CtrlShiftSpace');
  // The shortcut brings the window forward; the page readies the search field.
  await d.evaluate(() => { document.body.focus(); window.__focusRequest(); });
  assert(await d.evaluate(() => document.activeElement.id === 'q'), 'shortcut did not focus the search field');

  await d.click('#menuBtn'); await d.waitForSelector('.place-row');
  const pl = await d.textContent('#placeList');
  assert(pl.includes('free of') && pl.includes('ext4') && pl.includes('USB STICK'), pl);
  assert(await d.$('.pl-bar.full'), 'a nearly full drive is marked');
  await d.click('#sidebarClose');

  // First permission: looking in the bin. Nothing is read before Allow.
  await d.click('#scopeBtn'); await d.click('#scopeMenu [data-bin]');
  await d.waitForSelector('#consent[open]');
  assert((await d.textContent('#cTitle')).includes('Trash'));
  assert((await d.textContent('#cReads')).includes('Only your own Trash'));
  assert(!(await d.evaluate(() => window.__calls.some(c => c[0] === 'locate' && c[2].join() === 'trash'))), 'bin read before consent');
  await d.click('#cYes');
  await d.waitForSelector('.r-bin');
  assert(await d.evaluate(() => window.__calls.some(c => c[0] === 'locate' && c[2].join() === 'trash' && c[3] === null)), 'bin not asked for');
  assert((await d.$$('.r-bin')).length === 2);
  await d.click('#scopeLine [data-open-bin]');
  assert(await d.evaluate(() => window.__calls.some(c => c[0] === 'openBin')));

  // Second permission: each Restore. A refusal stays on screen with its reason.
  await d.click('.r-bin:has-text("clash.txt") [data-act="restore"]');
  await d.waitForSelector('#restore[open]');
  await d.click('#rsYes');
  await d.waitForSelector('#rsMsg:not([hidden])');
  assert((await d.textContent('#rsMsg')).includes('Nothing was overwritten'));
  assert(await d.isHidden('#rsYes'));
  await d.click('#rsNo');
  await d.click('.r-bin:has-text("report.docx") [data-act="restore"]');
  await d.click('#rsYes');
  await d.waitForFunction(() => !document.getElementById('restore').open);
  assert((await d.textContent('#toast')).includes('back in /home/u/Documents'));
  assert(await d.evaluate(() => window.__calls.filter(c => c[0] === 'restore').map(c => c[1][0]).join() === 'info/clash.txt.trashinfo,info/report.docx.trashinfo'));
  assert(derr.length === 0, derr.join('\n'));
  await dctx.close();
});

await test('no JavaScript errors', async () => {
  assert(errors.length === 0, errors.join('\n'));
});

// Phone width: nothing scrolls sideways and the tour fits.
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const m = await mctx.newPage();
await test('phone layout has no horizontal scroll', async () => {
  await m.goto(base);
  await m.waitForSelector('#welcome[open]');
  await m.screenshot({ path: path.join(out, 'mobile-welcome.png') });
  await m.keyboard.press('Escape');
  await type(m, 'budget');
  await m.waitForSelector('.r');
  const sw = await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert(sw[0] <= sw[1], 'page is ' + sw[0] + 'px wide on a ' + sw[1] + 'px screen');
  await m.screenshot({ path: path.join(out, 'mobile-results.png') });
});

await test('download page fits a phone and points phone visitors to their computer', async () => {
  await m.goto(base + 'download.html');
  await m.waitForSelector('.dl-hero');
  const sw = await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert(sw[0] <= sw[1], 'download page is ' + sw[0] + 'px wide on a ' + sw[1] + 'px screen');
  await m.screenshot({ path: path.join(out, 'mobile-download.png'), fullPage: true });
});

// Screenshots for a human look, light and dark.
for (const theme of ['light', 'dark']) {
  const c = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: theme });
  const p = await c.newPage();
  await p.goto(base);
  await p.waitForSelector('#welcome[open]'); await p.waitForTimeout(450);
  await p.screenshot({ path: path.join(out, theme + '-welcome.png') });
  await p.click('#wNext'); await p.waitForTimeout(450); await p.screenshot({ path: path.join(out, theme + '-welcome-2.png') });
  await p.click('#wNext'); await p.waitForTimeout(450); await p.screenshot({ path: path.join(out, theme + '-welcome-3.png') });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(out, theme + '-landing.png') });
  await type(p, 'budget'); await p.waitForSelector('.r');
  await p.screenshot({ path: path.join(out, theme + '-list.png') });
  await p.click('.r [data-act="preview"]'); await p.waitForTimeout(250);
  await p.screenshot({ path: path.join(out, theme + '-preview.png') });
  await p.click('#pvClose'); await p.click('#tabMap'); await p.waitForTimeout(250);
  await p.screenshot({ path: path.join(out, theme + '-map.png') });
  await p.click('#menuBtn'); await p.waitForTimeout(350);
  await p.screenshot({ path: path.join(out, theme + '-sidebar.png') });
  await p.click('#sidebarClose'); await p.click('#verifyBtn'); await p.waitForSelector('#checks .ci.ok'); await p.waitForTimeout(450);
  await p.screenshot({ path: path.join(out, theme + '-verify.png') });
  await c.close();
}

await browser.close();
if (server) server.close();
console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
