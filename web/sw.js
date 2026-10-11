// Offline cache for the app shell only. It never caches anything but these files, and the page itself cannot fetch.
var VERSION = 'lz-v12';
var SHELL = ['./', 'index.html', 'app.css', 'app.js', 'theme-boot.js', 'demo-data.js', 'icon.svg', 'manifest.webmanifest', 'download.html', 'download.js', 'privacy.html', 'terms.html', 'refund.html'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Network first for the app files so updates arrive, cache when offline. Anything else is passed through untouched.
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  // Installers and their manifest are never cached: they are large, and must always be the latest.
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.indexOf('__lz_probe__') >= 0 || url.pathname.indexOf('/downloads/') >= 0 || url.pathname.indexOf('/media/') >= 0) return;
  e.respondWith(fetch(e.request).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(e.request, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (m) { return m || caches.match('index.html'); });
  }));
});
