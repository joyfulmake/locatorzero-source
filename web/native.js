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
    restore: function (ids) { return invoke('trash_restore', { ids: ids }); },
    openBin: function () { return invoke('open_bin'); },
    // The global shortcut brings the window forward; the page then readies the search field.
    onFocusRequest: function (fn) { if (T.event && T.event.listen) T.event.listen('lz-focus', fn); },
    cleanup: {
      scan: function (path) { return invoke('cleanup_scan', { path: path }); },
      progress: function () { return invoke('cleanup_progress'); },
      stop: function () { return invoke('cleanup_stop'); },
      trash: function (items) { return invoke('cleanup_trash', { items: items }); }
    },
    licence: {
      status: function () { return invoke('licence_status'); },
      activate: function (key) { return invoke('licence_activate', { key: key }); },
      remove: function () { return invoke('licence_remove'); }
    }
  };
})();
