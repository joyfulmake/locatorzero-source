# Privacy

**Short version: LocatorZero sends nothing from your device and keeps no copy of what it finds.**
Every claim below can be checked: in the app (the **Verify** button in the footer) or in the source code.

## The app

| Question | Answer | How you can check |
|---|---|---|
| Does it look anywhere without asking? | No. Before the desktop app first searches your computer, and before it looks in any drive or folder you pick, it asks, and says exactly what it will read. In the browser, it sees only a folder you choose, after a consent step | **Search in** menu, and `askConsent()` in `web/app.js` |
| Does it send anything over the internet? | No. The app's security policy blocks every network request, its own included. The desktop core contains no networking library | Footer **Verify**: a live test request is blocked. Source: `web/_headers`, `desktop/check-no-network.sh` |
| Does it keep my searches? | No. Searches, results and previews live in memory only. They clear when you close the app, press **Wipe**, or after 5 minutes without use | Footer and sidebar; `wipe()` in `web/app.js` |
| Does it change, move or delete my files? | Searching never does. It reads names, sizes and dates, and opens a file only when you press **Preview**, reading at most the first 64 KB of text, or one image up to 10 MB. **Clean up** (desktop) is the one exception, and only on your say-so: it moves files you tick and confirm to the Recycle Bin or Trash, never deletes them outright, always leaves one copy, and first checks byte for byte that each duplicate still matches the copy you keep | `preview.rs`, `cleanup.rs` and their tests |
| What does Clean up read? | Names, sizes and dates in the place you choose (system and app folders are skipped). For files that share a size, three 16 KB samples each, in memory, to group likely copies. Before moving a duplicate, it reads it and the kept copy in full to compare them. Nothing is written or kept | `desktop/src-tauri/src/cleanup.rs` |
| Does it read my browser history? | The desktop app does, read-only, to find pages you visited. The browser's history file is opened in read-only mode and left byte-for-byte unchanged (tested). Private windows keep no history, so they are never found | `sources/history.rs` and its tests |
| My open tabs? | Only if you install the LocatorZero Tabs extension. It passes tab addresses and titles to LocatorZero on the same computer, through the browser's local channel. Private-window tabs are never shared | `extension/background.js` |
| Can it find files I deleted? | No. LocatorZero never keeps copies. If you permanently delete a file, it no longer appears, even if your system's own search index has not caught up yet | Test: `deleted_files_never_show_even_if_the_index_still_lists_them` |

**What is saved on your device, in full:**

| Where | What | Why |
|---|---|---|
| Browser storage (web and desktop) | `lz.theme`, `lz.welcomed`, `lz.welcomeNever`, and `lz.consent` (desktop, only if you tick "Don't ask again") | Light or dark, whether you've seen the tour or turned it off, and whether you allowed searching this computer. Drives and folders you pick are never remembered: LocatorZero asks again next time |
| `licence.json` in the app's data folder (desktop only) | The date you first opened the app, and your licence key if you entered one | The 90-day trial, and your licence |
| Browser settings folders (desktop, only if you press **Set up open tabs**) | One small file per browser that tells it how to start LocatorZero's tab helper | The open-tabs feature |
| Offline cache (web only) | The app's own files | So it works without internet |

**Two technical limits, stated plainly**
- Text you type also passes through the system webview (the browser engine that draws the app). That engine
  does not erase text from memory immediately; LocatorZero's own core does, and blocks other programs from reading
  its memory. Details: [docs/measurements.md](docs/measurements.md).
- Browser history is read without touching the browser's files. While a browser is open, its last few minutes of
  changes, including deletions, can sit in a side file this read-only method skips. They show correctly once the
  browser saves them, usually when it closes.

## The website

The web app is hosted on Cloudflare Pages. Loading the page is an ordinary request, which Cloudflare handles under
its own privacy policy (for example, it sees your IP address). After the page loads, it makes no requests and
carries nothing you type. No analytics, no cookies, no trackers.

## Buying a licence

Purchases will go through a reseller that acts as the legal seller (a "merchant of record"). It takes your
payment details, name, email address and country, issues your invoice, collects sales tax, and keeps the records
tax law requires. LocatorZero does not receive your card details.

What LocatorZero holds: the store's order records are visible to us in the store's dashboard, so we can handle
refunds and support. We don't copy them anywhere else, don't add them to any mailing list, and don't link them to
how you use the app, which we can't see anyway. Your licence key contains only the plan, the store's order
reference and the dates.

## Contact

Privacy questions: locatorzero.help@gmail.com.
