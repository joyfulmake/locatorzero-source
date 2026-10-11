// Static server for web/ that applies web/_headers the way Cloudflare Pages does, so local tests see the real policy.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const types = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function parseHeaders() {
  const rules = []; let cur = null;
  for (const line of fs.readFileSync(path.join(root, '_headers'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { cur = { pattern: line.trim(), headers: {} }; rules.push(cur); continue; }
    const t = line.trim();
    if (t.startsWith('!')) { (cur.detach ||= []).push(t.slice(1).trim().toLowerCase()); continue; }
    const i = t.indexOf(':'); cur.headers[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return rules;
}
const match = (p, url) => p.endsWith('*') ? url.startsWith(p.slice(0, -1)) : p === url;

export function start(port = 0) {
  const rules = parseHeaders();
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url.endsWith('/')) url += 'index.html';
    const file = path.join(root, path.normalize(url));
    const headers = {};
    // Pages applies every matching rule: a repeated header is joined with ", " (which for CSP means two policies,
    // both enforced), and "! Name" detaches a header set by an earlier rule.
    for (const r of rules) if (match(r.pattern, url)) {
      for (const d of r.detach || []) for (const k of Object.keys(headers)) if (k.toLowerCase() === d) delete headers[k];
      for (const [k, v] of Object.entries(r.headers)) headers[k] = headers[k] ? headers[k] + ', ' + v : v;
    }
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory() || path.basename(file) === '_headers') {
      res.writeHead(404, headers); return res.end('not found');
    }
    headers['Content-Type'] = types[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, headers); fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await start(+process.env.PORT || 8788);
  console.log('http://127.0.0.1:' + s.address().port);
}
