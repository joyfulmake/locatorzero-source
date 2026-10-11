// Records a ~75-second demo of the web app, then makes an MP4 (for Product Hunt, YouTube, X) and a GIF (for README,
// Reddit, the download page). Run: node tools/record-demo.mjs   (needs FFMPEG=/path/to/ffmpeg)
// Microsoft Store trailer: TRAILER=1 node tools/record-demo.mjs  → 1920×1080 MP4 with a silent audio track, plus a
// 1920×1080 thumbnail, in docs/store-assets/.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { start } from '../tests/serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs/media');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const TRAILER = process.env.TRAILER === '1';
const [W, H] = TRAILER ? [1920, 1080] : [1280, 720];
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(outDir, '.rec-'));

const server = await start(0);
const base = 'http://127.0.0.1:' + server.address().port + '/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: 'light', recordVideo: { dir: tmp, size: { width: W, height: H } } });

// A visible cursor, so viewers can follow the clicks. Added through Playwright, outside the page's own code.
await ctx.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    Object.assign(c.style, { position: 'fixed', zIndex: 2147483647, left: '0', top: '0', width: '22px', height: '22px', marginLeft: '-11px', marginTop: '-11px',
      borderRadius: '50%', background: 'rgba(79,70,229,.35)', border: '2px solid rgba(79,70,229,.9)', pointerEvents: 'none',
      transition: 'transform .55s cubic-bezier(.2,.8,.2,1)', transform: 'translate(640px, 600px)' });
    document.documentElement.appendChild(c);
    for (const d of document.querySelectorAll('dialog')) d.addEventListener('toggle', () => { if (d.open) d.appendChild(c); else document.documentElement.appendChild(c); });
  });
});

const p = await ctx.newPage();
const wait = ms => p.waitForTimeout(ms);
async function click(sel, pause = 700) {
  const el = p.locator(sel).first();
  const b = await el.boundingBox();
  await p.evaluate(([x, y]) => { const c = document.getElementById('__cursor'); if (c) c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }, [b.x + b.width / 2, b.y + b.height / 2]);
  await wait(650);
  await el.click();
  await wait(pause);
}
async function typeSlow(text) { await p.locator('#q').pressSequentially(text, { delay: 170 }); }

await p.goto(base);
await wait(3800);                                   // tour slide 1 with its animated example
await click('#wNext', 2600);                        // privacy promises
await click('#wNext', 2600);                        // comparison
await click('#wNext', 3400);                        // new: Clean up
await click('#wNext', 1200);                        // try it now
await click('#wTry', 2600);                         // demo search: budget
await click('#q', 200);
await p.fill('#q', ''); await wait(400);
await typeSlow('budg'); await wait(2200);           // instant results while typing
await click('#tabMap', 2400);                       // the map
await click('#map .node.toggle.closed', 1600);      // open a folder
await click('#map .node.leaf', 2600);               // preview
await click('#pvClose', 500);
await click('#tabList', 800);
await p.fill('#q', ''); await typeSlow('zzqqx'); await wait(2400);   // no matches, explained
await click('#tabMap', 2600);                       // where it looked
await click('#tabList', 400);
await click('#verifyBtn', 3600);                    // privacy checks, live
await click('#vClose', 600);
await click('#scopeBtn', 2200);                     // choose where to search
await p.keyboard.press('Escape'); await wait(400);
await p.fill('#q', ''); await typeSlow('invoice'); await wait(1200);
await click('#menuBtn', 900);                       // Clean up, from the menu
await click('#cleanSide', 1400);
await click('.cl-place[data-place=demo]', 2600);    // duplicates found in seconds
await click('#clAuto', 2000);                       // tick every extra copy; one copy always stays
await click('#clTabMap', 3400);                     // every copy on one map
await click('#clGo', 3200);                         // confirm first
await click('#ccYes', 2600);
await click('#clClose', 600);
await click('#themeBtn', 2600);                     // dark mode
await ctx.close();
await browser.close();
server.close();

const webm = fs.readdirSync(tmp).filter(f => f.endsWith('.webm')).map(f => path.join(tmp, f))[0];
if (TRAILER) {
  const dir = path.join(root, 'docs/store-assets');
  const trailer = path.join(dir, 'trailer-1920x1080.mp4'), thumb = path.join(dir, 'trailer-thumbnail-1920x1080.png');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', webm, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-shortest', '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-crf', '20', '-preset', 'slow',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', trailer]);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', '22', '-i', trailer, '-frames:v', '1', thumb]);
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of [trailer, thumb]) console.log(path.relative(root, f) + '  ' + (fs.statSync(f).size / 1048576).toFixed(1) + ' MB');
  process.exit(0);
}
const mp4 = path.join(outDir, 'locatorzero-demo.mp4');
const gif = path.join(outDir, 'locatorzero-demo.gif');
const palette = path.join(tmp, 'palette.png');
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', mp4]);
const vf = 'fps=10,scale=880:-1:flags=lanczos';
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', webm, '-vf', vf + ',palettegen=max_colors=128:stats_mode=diff', palette]);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', webm, '-i', palette, '-lavfi', vf + ' [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', gif]);
fs.rmSync(tmp, { recursive: true, force: true });
for (const f of [mp4, gif]) console.log(path.relative(root, f) + '  ' + (fs.statSync(f).size / 1048576).toFixed(1) + ' MB');
