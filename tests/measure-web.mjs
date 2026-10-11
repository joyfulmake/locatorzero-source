// Percentile measurements for the web app in headless Chromium: keystroke to painted results, and preview
// request to painted preview. Prints a markdown table. Run: node tests/measure-web.mjs
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { start } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = await start(0);
const base = 'http://127.0.0.1:' + server.address().port + '/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
await page.goto(base);
await page.keyboard.press('Escape');

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const row = (name, a) => `| ${name} | ${a.length} | ${pct(a, 50).toFixed(1)} | ${pct(a, 95).toFixed(1)} | ${pct(a, 99).toFixed(1)} |`;

// Keystroke to painted: from dispatching the input event to the frame after the list is in the DOM.
async function keystrokes(queries) {
  return page.evaluate(async qs => {
    const q = document.getElementById('q'), out = [];
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (const s of qs) {
      q.value = ''; q.dispatchEvent(new Event('input')); await frame();
      const t0 = performance.now();
      q.value = s; q.dispatchEvent(new Event('input'));
      await frame();
      out.push(performance.now() - t0);
    }
    return out;
  }, queries);
}

const words = ['budget', 'inv', 'report 2025', 'png', 'notes', 'a', 'contract final', 'IMG_', 'tax', 'zzzz', 'project atlas', 'xlsx', 'resume', 'meeting', 'docs', 'q'];
const qs = Array.from({ length: 300 }, (_, i) => words[i % words.length]);
const demo = await keystrokes(qs);

await page.evaluate(() => {
  const lz = window.__lz, items = [], names = ['budget', 'invoice', 'report', 'notes', 'photo', 'contract', 'resume', 'tax'];
  for (let i = 0; i < 300000; i++) {
    const n = names[i % 8] + '-' + i + (i % 3 ? '.pdf' : '.png');
    items.push(lz.prep({ n, p: 'Big/dir' + (i % 900) + '/sub' + (i % 37) + '/' + n, s: 'folder', src: 'Your folder · Big', k: i % 3 ? 'doc' : 'img', z: i, t: Date.now() - i * 1000 }));
  }
  lz.state.folders.push({ id: 99, name: 'Big', items, done: true });
});
const big = await keystrokes(qs.slice(0, 200));

// Preview: click Preview on a demo text item, until the preview body is painted.
const pv = await page.evaluate(async () => {
  const lz = window.__lz, q = document.getElementById('q'), out = [];
  lz.state.folders = [];
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  q.value = 'notes'; q.dispatchEvent(new Event('input')); await frame();
  for (let i = 0; i < 100; i++) {
    const btn = document.querySelectorAll('.r [data-act="preview"]')[i % 10];
    const t0 = performance.now();
    btn.click();
    while (!document.querySelector('#pvBody pre, #pvBody img, #pvBody .pv-msg')) await new Promise(r => setTimeout(r, 1));
    await frame();
    out.push(performance.now() - t0);
    document.getElementById('pvClose').click();
  }
  return out;
});
const heap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);

const table = ['| Measurement (web, headless Chromium) | Runs | p50 ms | p95 ms | p99 ms |', '|---|---|---|---|---|',
  row('Keystroke to painted results, demo data (2,785 items)', demo),
  row('Keystroke to painted results, 300,000 items', big),
  row('Preview request to painted (demo, includes a 60 ms simulated read)', pv)].join('\n');
console.log(table + '\n\nJS heap after 300,000 items loaded: ' + heap + ' MB');
fs.writeFileSync(path.join(here, 'out', 'measure-web.md'), table + '\n\nJS heap with 300,000 items: ' + heap + ' MB\n');
await browser.close(); server.close();
