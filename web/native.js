// Desktop bridge. Only the desktop build includes this file; the web app runs without it.
// Calls go to LocatorZero's own Rust commands over Tauri's in-process IPC, never to a network.
(function () {
  'use strict';
  var T = window.__TAURI__;
  if (!T || !T.core) return;
  document.documentElement.classList.add('native');
  var invoke = T.core.invoke;
  window.LZ_NATIVE = {
    locate: function (query, sources, scope) { return invoke('locate', { query: query, sources: sources, limit: 400, scope: scope || null }); },
    places: function () { return invoke('places'); },
    pickFolder: function () { return invoke('pick_folder'); },
    placeProgress: function (path) { return invoke('place_progress', { path: path }); },
    forget: function () { return invoke('forget'); },
    preview: function (path) { return invoke('preview', { path: path }); },
    reveal: function (path, url) { return invoke('reveal', { path: path || null, url: url || null }); },
    status: function () { return invoke('status'); },
    setupTabs: function () { return invoke('setup_tabs'); },
    licence: {
      status: function () { return invoke('licence_status'); },
      activate: function (key) { return invoke('licence_activate', { key: key }); },
      remove: function () { return invoke('licence_remove'); }
    }
  };
})();
