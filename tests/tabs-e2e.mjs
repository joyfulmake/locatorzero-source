// Real browser, real extension, real host: Chromium loads extension/, launches the release binary as its
// native-messaging host, and we read the open tabs back over the private socket like the app does.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'desktop/src-tauri/target/release/locatorzero');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-tabs-'));
const cfg = path.join(tmp, 'config'), run = path.join(tmp, 'run');
fs.mkdirSync(path.join(cfg, 'chromium/NativeMessagingHosts'), { recursive: true });
fs.mkdirSync(run, { mode: 0o700 });
// Chromium reads host registrations from <user data dir>/NativeMessagingHosts, so register in the test profile.
const hostManifest = JSON.stringify({
  name: 'dev.locatorzero.tabs', description: 'test', path: bin, type: 'stdio',
  allowed_origins: ['chrome-extension://lkodnhoihmagdbkmcicjjjgfipmfphio/']
});
fs.mkdirSync(path.join(tmp, 'profile/NativeMessagingHosts'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile/NativeMessagingHosts/dev.locatorzero.tabs.json'), hostManifest);
fs.writeFileSync(path.join(cfg, 'chromium/NativeMessagingHosts/dev.locatorzero.tabs.json'), hostManifest);

const server = await start(0);
const base = 'http://127.0.0.1:' + server.address().port + '/';
const ext = path.join(root, 'extension');
const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  headless: true,
  args: ['--headless=new', '--no-sandbox', '--disable-extensions-except=' + ext, '--load-extension=' + ext],
  env: { ...process.env, CHROME_CONFIG_HOME: cfg, XDG_RUNTIME_DIR: run }
});
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
console.log('  extension worker: ' + (sw ? sw.url() : 'NOT LOADED'));
const p1 = await ctx.newPage(); await p1.goto(base + '?tab=atlas-roadmap');
const p2 = await ctx.newPage(); await p2.goto(base + '?tab=quarterly-budget');

function ask(sock) {
  return new Promise((res, rej) => {
    const c = net.createConnection(sock, () => c.write('list\n'));
    let buf = ''; c.on('data', d => buf += d); c.on('end', () => res(buf)); c.on('error', rej);
    setTimeout(() => { c.destroy(); res(buf); }, 800);
  });
}

let ok = false, reply = '';
for (let i = 0; i < 40 && !ok; i++) {
  await new Promise(r => setTimeout(r, 250));
  const d = fs.readdirSync(run).map(n => path.join(run, n)).find(p => fs.statSync(p).isDirectory());
  if (!d) continue;
  for (const s of fs.readdirSync(d)) {
    reply = await ask(path.join(d, s)).catch(() => '');
    if (reply.includes('quarterly-budget') && reply.includes('atlas-roadmap')) ok = true;
  }
}
await ctx.close(); server.close();
await new Promise(r => setTimeout(r, 500));
const d = fs.readdirSync(run).map(n => path.join(run, n)).find(p => fs.statSync(p).isDirectory());
const leftover = d ? fs.readdirSync(d).length : 0;
fs.rmSync(tmp, { recursive: true, force: true });
console.log(ok ? '  ✓ extension → host → socket returned both open tabs' : '  ✗ tabs never arrived: ' + reply.slice(0, 300));
console.log(leftover === 0 ? '  ✓ host removed its socket when the browser closed' : '  ✗ ' + leftover + ' socket(s) left behind');
process.exit(ok && leftover === 0 ? 0 : 1);
