#!/usr/bin/env bash
# Launches the real desktop app on a virtual display, types a search, and saves screenshots.
# Usage: xvfb-run -a -s "-screen 0 1280x860x24" tests/desktop-smoke.sh <query>
set -uo pipefail
q="${1:-hostname}"
out="$(dirname "$0")/out/desktop"; mkdir -p "$out"
bin="${BIN:-$(dirname "$0")/../desktop/src-tauri/target/release/locatorzero}"
export WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 NO_AT_BRIDGE=1
eval "$(dbus-launch --sh-syntax 2>/dev/null)" || true
# A fresh profile every run, like a first launch: tour, then the consent question.
export XDG_DATA_HOME="$(mktemp -d)"; trap 'rm -rf "$XDG_DATA_HOME"' EXIT
"$bin" >"$out/app.log" 2>&1 &
pid=$!
for i in $(seq 1 40); do xdotool search --name '^LocatorZero$' >/dev/null 2>&1 && break; sleep 0.5; done
win=$(xdotool search --name '^LocatorZero$' | head -1)
[ -n "$win" ] || { echo "window never appeared"; cat "$out/app.log"; kill $pid; exit 1; }
xdotool windowactivate --sync "$win" 2>/dev/null; xdotool windowfocus "$win"; sleep 2.5
import -window root "$out/1-welcome.png"
xdotool key Escape; sleep 0.8
import -window root "$out/2-consent.png"
xdotool key Return; sleep 0.6         # "Allow and search" has focus
import -window root "$out/2-landing.png"
xdotool type --delay 60 "$q"; sleep 2.5
import -window root "$out/3-results.png"
xdotool key Tab; sleep 0.2; xdotool key 2; sleep 1.2
import -window root "$out/4-map.png"
xdotool key 1 slash Return; sleep 1.5
import -window root "$out/5-preview.png"
xdotool key Escape; sleep 0.3; xdotool key Tab; sleep 0.2; xdotool key s; sleep 1.2
import -window root "$out/6-sidebar.png"
xdotool key Escape; sleep 0.4; xdotool key slash; sleep 0.2; xdotool key shift+Tab Return; sleep 1.2
import -window root "$out/7-scope-menu.png"
xdotool key Down Return; sleep 0.8       # first place after Everywhere: your home folder
import -window root "$out/8-place-consent.png"
xdotool key Return; sleep 2.5
import -window root "$out/9-place-results.png"
kill $pid; wait $pid 2>/dev/null
echo "screenshots in $out"
