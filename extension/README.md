# LocatorZero Tabs

A browser extension that lets the LocatorZero desktop app find your **open tabs** (ADR-0019, preferred path).

- Sends address, title, window and last-used time of each tab, over the browser's native-messaging pipe, to
  LocatorZero on this computer. LocatorZero keeps the list in memory only.
- Has no host permissions and no network code. Private-window tabs are never sent.

## Install (until it is in the stores)

1. In LocatorZero, open the sidebar and press **Set up open tabs**. This registers LocatorZero with your browsers.
2. Chrome, Edge, Brave: open `chrome://extensions`, turn on Developer mode, **Load unpacked**, pick this folder.
   Firefox: `about:debugging` → This Firefox → **Load Temporary Add-on** → pick `manifest.json`.

The Chromium extension ID is fixed by the public key in `manifest.json`: `lkodnhoihmagdbkmcicjjjgfipmfphio`.
The private key is in `locatorzero-private/secrets/` and is never committed.
