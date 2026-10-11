#!/usr/bin/env bash
# The trial and licence flow in the real desktop app, using a throwaway data folder:
# 1) a trial that ended 10 days ago pauses searching and shows the plans screen,
# 2) pasting a key issued by tools/issue-licence.mjs unlocks it, 3) licence.json holds only the date and the key.
# Usage: xvfb-run -a -s "-screen 0 1280x860x24" tests/desktop-licence.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; out="$here/out/desktop"; mkdir -p "$out"
bin="${BIN:-$here/../desktop/src-tauri/target/release/locatorzero}"
export WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 NO_AT_BRIDGE=1
eval "$(dbus-launch --sh-syntax 2>/dev/null)" || true
data=$(mktemp -d); export XDG_DATA_HOME="$data"
mkdir -p "$data/dev.locatorzero.app"
echo "{\"first_run_ms\": $(( ($(date +%s) - 100*86400) * 1000 )), \"key\": null}" > "$data/dev.locatorzero.app/licence.json"
key=$(node "$here/../tools/issue-licence.mjs" --plan lifetime --ref TEST-ORDER-1)
"$bin" >/dev/null 2>&1 & pid=$!
for i in $(seq 1 40); do xdotool search --name '^LocatorZero$' >/dev/null 2>&1 && break; sleep 0.5; done
win=$(xdotool search --name '^LocatorZero$' | head -1); xdotool windowactivate --sync "$win" 2>/dev/null; sleep 3
xdotool key Escape; sleep 1.5          # close the welcome tour; the trial-ended screen follows
import -window root "$out/L1-trial-ended.png"
xdotool type --delay 2 "$key"; xdotool key Return; sleep 1.5
import -window root "$out/L2-activated.png"   # the consent question follows activation
xdotool key Return; sleep 0.8
xdotool type --delay 50 "hostname"; sleep 2
import -window root "$out/L3-searching.png"
kill $pid; wait $pid 2>/dev/null
echo "licence.json now holds: $(python3 -c "import json,sys;print(sorted(json.load(open(sys.argv[1])).keys()))" "$data/dev.locatorzero.app/licence.json")"
grep -q '"key": "LZ1.' "$data/dev.locatorzero.app/licence.json" && echo "  ✓ key stored" || echo "  ✗ key not stored"
rm -rf "$data"
