// Copies the web app into desktop/dist for the Tauri build. Two changes only:
// the CSP allows Tauri's in-process IPC (still no network origin), and native.js is loaded before app.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'web');
const dist = path.join(here, 'dist');
// Website-only files: the desktop app needs the app itself, not the download page, its video or the signing key.
const skip = new Set(['_headers', 'sw.js', 'manifest.webmanifest', 'download.html', 'download.js', 'locatorzero-release-key.asc', 'key.html', 'key.js']);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const f of fs.readdirSync(src)) {
  if (skip.has(f) || fs.statSync(path.join(src, f)).isDirectory()) continue; // media/, downloads/
  fs.copyFileSync(path.join(src, f), path.join(dist, f));
}

const indexPath = path.join(dist, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const before = html;
html = html
  .replace("connect-src 'none'", 'connect-src ipc: http://ipc.localhost')
  .replace('  <link rel="manifest" href="manifest.webmanifest">\n', '')
  .replace('<script src="app.js"></script>', '<script src="native.js"></script>\n  <script src="app.js"></script>');
if (html === before || !html.includes('native.js') || html.includes("connect-src 'none'")) {
  console.error('build-frontend: expected markers not found in web/index.html');
  process.exit(1);
}
fs.writeFileSync(indexPath, html);
console.log('desktop/dist ready (' + fs.readdirSync(dist).length + ' files)');
