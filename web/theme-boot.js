// Runs before first paint so the chosen theme never flashes. External file because the CSP forbids inline script.
(function () {
  var t = null;
  try { t = localStorage.getItem('lz.theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', t);
})();
