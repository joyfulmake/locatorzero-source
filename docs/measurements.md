# Measurements against the NFR budgets

Measured 2026-10-08 on one machine: a VMware virtual machine with 4 vCPUs of an Intel i7-11370H, 7.7 GB RAM,
a virtual disk, Kali Linux, software rendering (no GPU) under Xvfb for the desktop runs. That is not the benchmark
hardware named in the architecture repo, so treat these as a first reading, not a certification.

Every number can be reproduced with the script named beside it.

## Latency

| NFR | Budget | Measured | Verdict | Script |
|---|---|---|---|---|
| NFR-01 web, keystroke to painted results, demo data (2,785 items), 300 runs | p50 ≤ 40, p95 ≤ 120, p99 ≤ 300 ms | p50 32.8, p95 48.0, p99 58.5 ms | **Meets** | `node tests/measure-web.mjs` |
| NFR-01 web, same with 300,000 items in memory, 200 runs | same | p50 48.8, p95 68.6, p99 81.2 ms | p50 misses by 9 ms; p95 and p99 meet | same |
| NFR-01 desktop, one search across files + history + processes + tabs, 100 real queries | same | p50 33.1, p95 245, p99 338 ms | p50 meets; **p95 and p99 miss** | `cargo test --release bench_locate -- --ignored --nocapture` |
| Context panel, metadata only | p95 ≤ 16 ms | Not separately timed; it renders in the same frame as the click | Not measured | — |
| Bounded preview | ≤ 400 ms, ≤ 64 KB | Web demo p95 113 ms; desktop real file 57–62 ms; cap tested at exactly 65,536 bytes | **Meets** | `tests/measure-web.mjs`, `tests/desktop-smoke.sh`, unit tests |

Per source on the desktop (40 queries each): files p50 22.9 / p95 241 ms, browser history p50 1.6 / p95 2.2 ms,
processes p50 23.7 / p95 27.9 ms, open tabs under 0.1 ms. Since this run, every file result is checked against
the disk so deleted files never show; that check is included in these numbers.

**Why desktop p95 misses:** one query in the mix, `kali`, is this machine's user name and appears in almost every
path, so the system index (plocate) scans nearly the whole database: 225 ms. Every other query took 3 to 45 ms in
plocate. Two fixes made along the way: searching file names before whole paths, and reading sizes and dates only
for the first 150 results. Together they cut p50 from 64 to 28 ms and p99 from 725 to 261 ms; checking every result against the disk then
brought p50 to 33 ms and p99 to 338 ms. Further options: run
a whole-path match only after a pause in typing, or show history and process results before file results arrive.

**One fix in the web app:** each search used to wait one animation frame (about 16 ms) before running. It now runs
in the same frame as the keystroke, which moved p50 from 43.9 to 32.8 ms.

## Memory

| NFR | Budget | Measured | Verdict | Script |
|---|---|---|---|---|
| NFR-03 resident memory, idle (desktop) | ≤ 60 MB | 466 MB RSS / **169 MB PSS** across the app and its webview processes | **Misses** | `tests/measure-desktop.sh` |
| NFR-03 with 5 million records | ≤ 250 MB | Not measured. Web: 80 MB JS heap with 300,000 records | Not measured | `tests/measure-web.mjs` |

RSS counts shared libraries once per process, so PSS (proportional set size) is the fairer total. Most of it is
the system webview (WebKitGTK): its page process is about 133 MB PSS on its own. The 60 MB idle budget was written
for a Rust core and is not reachable with a webview interface. Either the budget moves, or the desktop interface
moves to a native toolkit.

## Memory wipe, NFR-04

Budget: no query string recoverable from memory 1 second after lock or exit, across 100 trials.

Method: type a unique marker, wait, clear the search, wait 1.2 s, then scan every writable memory region of the
app and its webview processes for the marker (UTF-8 and UTF-16).

| Process | Before hardening | After hardening |
|---|---|---|
| LocatorZero core (Rust) | 5 copies | **Unreadable**: marked non-dumpable, so no core dumps and no same-user process can read its memory |
| Webview page process | 7 copies | 9–10 copies (varies by run) |
| Webview network process | 0 | 0 |

**Verdict: misses.** Hardening added: the core overwrites its own copies of the query when a search finishes, and
on Linux it sets `PR_SET_DUMPABLE=0`. The copies that remain sit in the browser engine's JavaScript strings and
text-field buffers, which no web page or app code can zero. On exit the operating system reclaims all of it. This
one trial is not the 100 trials the NFR asks for.

What would meet it: a native Rust interface with zeroizing text buffers, at the cost of rewriting the desktop
interface; or restating the NFR as "nothing written to disk; memory released on exit and protected from other
programs", which the app now meets on Linux.

About the "WebKitNetworkProcess" in the process list: WebKitGTK always starts it, including for local pages. The
page's security policy blocks every request it could make, and the scan found no copies of the marker in it.

## Read-only and no network

| NFR | Budget | Measured | Verdict | Where |
|---|---|---|---|---|
| NFR-10 zero writes to sources | 0 write syscalls during a sweep | Browser history databases are byte-identical after a read, and no lock or journal file appears (unit test). A full syscall trace was not run | Partly measured | `cargo test` |
| No network | none | Web: CSP `connect-src 'none'`, live probe blocked, 0 requests while searching (e2e). Desktop: no networking crate in 236 dependencies | **Meets** | `npm test`, `desktop/check-no-network.sh` |

The one file the app writes: when you press "Set up open tabs", it writes one small registration file per installed
browser so the browser can start LocatorZero's tab host.
