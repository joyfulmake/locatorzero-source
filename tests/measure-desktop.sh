#!/usr/bin/env bash
# Desktop memory and the NFR-04 canary: type a unique marker, clear it, and count copies left in memory.
# Usage: xvfb-run -a -s "-screen 0 1280x860x24" tests/measure-desktop.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${BIN:-$here/../desktop/src-tauri/target/release/locatorzero}"
export WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 NO_AT_BRIDGE=1
eval "$(dbus-launch --sh-syntax 2>/dev/null)" || true
# A fresh profile every run, like a first launch: tour, then the consent question.
export XDG_DATA_HOME="$(mktemp -d)"; trap 'rm -rf "$XDG_DATA_HOME"' EXIT
marker="zq$(date +%s)canary"
"$bin" >/dev/null 2>&1 &
pid=$!
for i in $(seq 1 40); do xdotool search --name '^LocatorZero$' >/dev/null 2>&1 && break; sleep 0.5; done
win=$(xdotool search --name '^LocatorZero$' | head -1)
xdotool windowactivate --sync "$win" 2>/dev/null; sleep 3; xdotool key Escape; sleep 1; xdotool key Return; sleep 2
echo "## Idle, tour closed"; python3 "$here/scan_memory.py" $pid "$marker" | tail -1
xdotool type --delay 40 "$marker"; sleep 2
echo "## Marker typed and searched"; python3 "$here/scan_memory.py" $pid "$marker"
xdotool key Escape; sleep 1.2
echo "## 1.2 s after clearing the search"; python3 "$here/scan_memory.py" $pid "$marker"
kill $pid; wait $pid 2>/dev/null
