# Roadmap

Status as of 15 October 2026. ✅ done · 🔜 next · 🧭 later · ⚖️ needs a decision from the owner.

## v0.1: built and tested ✅

- Web app live at https://locatorzero.pages.dev: search, Locations and Map tabs, preview, sidebar, light and dark,
  welcome tour, always-visible privacy strip with live checks, offline after first visit.
- Desktop app for Linux, Windows and macOS: whole-computer search via the system index, browser history, running
  apps, open tabs (Linux and macOS), show in folder, open in browser.
- Open-tabs browser extension for Chrome, Edge, Brave and Firefox.
- **Search in** selector inside the search field (everywhere, home, drives, cloud folders, any folder), with a
  consent step before each place is read. The web version replaces its folder button with a privacy disclaimer.
- 90-day trial and offline licence keys; plans window with $3/month, $25/year, $35 lifetime (version 1 only).
- Installers built by CI: `.deb`, AppImage, `.msi`, `.exe`, `.dmg` (Apple Silicon and Intel).
- Measured against the NFR budgets, misses included ([docs/measurements.md](docs/measurements.md)).
- LICENSE (source-available, draft), PRIVACY.md, SECURITY.md, architecture, pricing and legal checklists.

## v0.2: Clean up (built; testing on Windows before release) 🔜

- **Duplicates and largest files** in a place the user chooses and allows: list or map of every copy, "Tick all
  extra copies", sizes freed. Web app: the same flow on demo files, with nothing moved.
- **Safe by construction** (`desktop/src-tauri/src/cleanup.rs`): names and sizes first; three 16 KB samples only for
  files that share a size; system, app and hidden folders skipped; symbolic links never followed. Nothing changes
  until the user confirms in a second window. Then each duplicate is compared byte for byte with the kept copy and
  moved to the Recycle Bin or Trash; one copy always stays; only paths from the latest scan can be moved.
- Measured on this machine: a home folder of 178,000 files scanned in 8.4 s, a 276,000-file folder in 8.6 s.
- Next for Clean up: deleted-by-mistake help (v0.3 below), then leftovers (installers for apps already installed,
  empty folders), old downloads, and similar photos (shared with the mobile plan below).

## v0.3: Deleted by mistake? (built 15 Oct 2026; parts 1 and 2) ✅

Also in 0.3: kind chips with counts and grouping by type, place or folder; typed filters (`ext:`, `size:`,
`modified:`, `type:`); connected places with free space and file system; the Ctrl/⌘ Shift Space shortcut; a plain
statement under the web search field of what the browser version can see; a demo Recycle Bin in the web app.
Part 1 is implemented with the `trash` crate's `os_limited::list` and `restore_all` (Windows shell Recycle Bin,
freedesktop Trash for this user id), in `desktop/src-tauri/src/sources/trash.rs`. Needs a run on a real Windows machine.

Decided 13 Oct 2026. Three parts, in order:

**1. Search the Recycle Bin and Trash, with Restore.** Type a name and a deleted file shows up as "in the Recycle
Bin, deleted yesterday from Documents", with **Restore** (back to where it was) and **Show in bin**. Read-only until
the user presses Restore. Nothing is kept: the bin itself is the source, read live, like browser history.

| OS | How | What works |
|---|---|---|
| Windows | Each drive's `$Recycle.Bin\<your account>` folder: the `$I` file holds the original path, size and deletion time | Find, original folder, date, Restore. No admin rights |
| Linux | The freedesktop Trash: `~/.local/share/Trash` and `.Trash-<uid>` on other drives, with `.trashinfo` files | Find, original folder, date, Restore |
| macOS | `~/.Trash`; macOS asks the user once to allow access (Full Disk Access) | Find and date; Restore via Finder's "Put Back" (asks permission once). Original folder only where Finder records it |
| Android (mobile plan) | The system Trash (Android 11+) | Find and Restore |
| iOS | Apps can't read "Recently Deleted" | Not possible |
| Cloud bins (OneDrive, Dropbox, Google Drive) | Online only, and LocatorZero never connects | Not included; the help card links to them instead |

**2. "Permanently deleted?" help card.** When a search finds nothing, or from the menu: what to do now, per system.
Stop saving to that drive; then Windows: Windows File Recovery (free, Microsoft) or Recuva; macOS: Time Machine;
Linux: your backups, or TestDisk/PhotoRec (free, every OS). Plus the cloud bins, which keep files about 30 days.
Text only: nothing is scanned.

**3. Later, as a separate opt-in tool: LocatorZero Rescue.** Real recovery of permanently deleted files, kept apart
from the main app so its promise ("delete a file and it's gone here too") stays true. Needs administrator rights,
explicit consent per drive, shows only what can still be recovered, and always restores to a different drive.

| Where | Realistic? |
|---|---|
| USB sticks and SD cards (FAT32, exFAT), on Windows, macOS and Linux | Yes, the best case: these don't wipe deleted data straight away |
| Windows hard drives (NTFS) | Often, by reading the master file table |
| Windows and Linux SSDs | Rarely: SSDs erase deleted blocks within minutes (TRIM). Names may show while contents are gone, and the tool must say so |
| macOS internal disk (APFS) | No: macOS blocks raw disk access |

## Before selling: launch checklist 🔜

| Item | Owner | Notes |
|---|---|---|
| ⚖️ Legal entity, then counsel review | Owner + counsel | Contact (locatorzero.help@gmail.com) and governing law (India) are filled in; the licensor is "LocatorZero" for now |
| ⚖️ Counsel review of LICENSE, terms of sale (web/terms.html), refund policy (web/refund.html) | Counsel | [docs/pricing-and-selling.md](docs/pricing-and-selling.md) has the checklist |
| ⚖️ India prices | Owner | Starting idea: ₹299/year, ₹999 lifetime |
| Connect Lemon Squeezy checkout (chosen 8 Oct 2026) | Owner sets up the store, then build | Turns the "Store opens soon" buttons on |
| Stateless key-issuing function (no database) | Build | Order reference in, signed key out, same key every time |
| Code-signing certificates: Windows, Apple Developer ID and notarisation | Owner buys, CI signs | Removes SmartScreen and Gatekeeper warnings |
| Run the Windows and macOS installers on real machines | Test | CI builds them; nobody has run them yet |
| Publish the extension to the Chrome Web Store and Firefox Add-ons | Build | Store review needs a privacy policy: PRIVACY.md |
| ✅ Public download page: locatorzero.pages.dev/download.html | Done | AppImage still needs a host for files over 25 MB (enable Cloudflare R2, or a public release repo) |
| Launch plan: Product Hunt, Show HN, Reddit, package managers; enterprise design partners | Owner | docs/launch-plan.md |

## Next 🔜

- **Open tabs on Windows**: a named-pipe tab host.
- **Faster worst-case desktop search**: show history and app results first, and run the whole-path file match only
  after typing pauses. Target: p95 under 120 ms (now 245 ms, from one query type).
- **Paired devices**: an agent on your other computers, so one search covers them (ADR-0018).
- **More sources**: mounted phones (MTP), more browsers (Opera, Arc, Safari history on macOS with permission).
- **Accessibility audit** with a screen reader, and translations.

## Later 🧭

- **Native desktop interface** (Rust, no webview) to meet the 60 MB idle-memory and memory-wipe budgets.
- **Enterprise tier**: fleet search bound to a declared purpose, step-up sign-in, deny-by-default policy, and an
  append-only audit log (ADR-0012). Needs the legal positions in docs/legal-brief.md first.
- **Mobile**: Android first, then iOS. See [Mobile plan](#mobile-plan-android-then-ios-) below.

## Mobile plan: Android, then iOS 📱

Same promise as the desktop app: everything runs on the phone, nothing is uploaded, no account. On Android the app
ships **without the INTERNET permission**, so anyone can confirm from the Play listing that it cannot go online.

**Rule for cleanup features: LocatorZero suggests, you choose, the phone confirms.** The app never deletes anything
on its own. You tick what to remove, and the deletion goes through the system's own confirmation (Android's delete
request, iOS's Photos prompt), into the system bin where one exists (Android Trash, iOS Recently Deleted), so a
mistake can be undone. Nothing is ever deleted outside the items you ticked.

### Phase 1: find and free up space (Android)

| Feature | What the user sees | How, offline |
|---|---|---|
| **Find anything** | Type a few letters: files on the phone, SD card and USB (OTG) drives, as a list or map | Android's media index plus a walk of allowed folders; needs Play's "All files access" approval as a file manager |
| **Duplicate files** | "38 copies of the same files, 2.1 GB": keep one, tick the rest | Group by size, then a partial hash, then a full hash, so only true copies match |
| **Chat app media** | WhatsApp and Telegram images, videos and voice notes, by chat folder, size and age, including the same photo forwarded many times | Their media folders on shared storage, with duplicate matching |
| **Large and forgotten files** | The 20 biggest files; downloads not opened in 6 months | File sizes and dates |
| **Leftovers** | Installer files (APKs) for apps already installed, empty folders, old thumbnail caches | Compares APK package names with installed apps |
| **Storage map** | A map of what fills the phone, folder by folder | The desktop app's map, reused |
| **Space saved** | "You freed 3.4 GB this month", kept on the phone only | A local counter |

### Phase 2: photos and smarter cleanup (Android and iOS)

| Feature | What the user sees | How, offline |
|---|---|---|
| **Similar photos** | Bursts and near-identical shots side by side, with the best one suggested to keep | Perceptual image hashes computed on the phone; sharpness and exposure scores pick the keeper |
| **Blurry, dark and accidental shots** | Photos that are blurred, black or taken by accident | On-device image checks, no cloud AI |
| **Screenshots and memes** | Old screenshots grouped by month, ready to clear | Photo library metadata |
| **Big videos** | Videos sorted by size, with how much a shorter clip would save | Photo library metadata |
| **iOS Files** | Search and duplicates inside folders you pick, including iCloud Drive folders already on the phone | iOS only allows folders the user chooses; the app keeps that limited access |
| **Weekly tidy-up** | An optional reminder: "1.2 GB of new duplicates and screenshots" | Scheduled on the phone, no server push |

### Phase 3: one search across your devices

- **Search your computers from the phone**: "which laptop or drive has the 2024 tax PDF?" Phone and computers talk
  directly over your home Wi-Fi, encrypted and paired by QR code, with no server in between (ADR-0018).
- **Send to phone / send to computer** for a found file, over the same direct link.

### What phones don't allow (so we won't promise it)

- Reading other apps' browser history or open tabs (Android and iOS both forbid it).
- Searching the whole iPhone: iOS only allows the Photos library (with permission) and folders the user picks.
- Cleaning other apps' private caches: Android 11 and later reserve that for the system's own "Clear cache".

### Open questions

- How to sell in the app stores: Google Play and the App Store require their own billing for purchases made inside
  the app (and take a 15% commission for small developers), so the mobile apps either sell through store billing at
  the same prices, or accept a key bought on our site where the store rules allow it.

### Decided

- **Mobile pricing is the same as desktop (11 Oct 2026):** 90 days free, then $3/month, $25/year or $35 lifetime
  (version 1). Phones now hold as much as many computers, and with USB (OTG) drives they reach just as many places,
  so the value is the same.
- **Clean up ships on desktop first (11 Oct 2026):** the same engine powers the phone apps later. Built in v0.2.

