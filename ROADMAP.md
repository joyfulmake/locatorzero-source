# Roadmap

Status as of 8 October 2026. ✅ done · 🔜 next · 🧭 later · ⚖️ needs a decision from the owner.

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
- **Mobile**: a viewer that searches your paired computers, not the phone itself (ADR-0018 option D).
