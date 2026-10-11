// LocatorZero Tabs: sends the list of open tabs (address, title, window, last used) to the LocatorZero desktop app
// on this computer through the browser's native-messaging pipe. There is no network code here and no host
// permission, so this extension cannot reach any website. Tabs in private windows are never sent.
'use strict';
const api = globalThis.browser ?? globalThis.chrome;
const HOST = 'dev.locatorzero.tabs';
let port = null;
let timer = null;

function browserName() {
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Edg\//.test(ua)) return 'Edge';
  if (navigator.brave) return 'Brave';
  if (/Vivaldi\//.test(ua)) return 'Vivaldi';
  return 'Chrome';
}

async function push() {
  if (!port) return;
  const tabs = await api.tabs.query({});
  port.postMessage({
    type: 'tabs',
    browser: browserName(),
    tabs: tabs.filter(t => !t.incognito && t.url).map(t => ({
      id: t.id, w: t.windowId, url: t.url, title: t.title || '', last: Math.round(t.lastAccessed || 0), active: !!t.active
    }))
  });
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => push().catch(() => {}), 250);
}

function connect() {
  try {
    port = api.runtime.connectNative(HOST);
  } catch (e) {
    port = null;
    setTimeout(connect, 60000);
    return;
  }
  port.onDisconnect.addListener(() => { port = null; setTimeout(connect, 60000); });
  port.onMessage.addListener(m => { if (m && m.type === 'refresh') schedule(); });
  schedule();
}

for (const ev of ['onCreated', 'onUpdated', 'onRemoved', 'onActivated', 'onReplaced', 'onAttached', 'onDetached']) {
  api.tabs[ev].addListener(schedule);
}
connect();
