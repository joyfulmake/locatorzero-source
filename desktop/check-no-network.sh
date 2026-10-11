#!/usr/bin/env bash
# Two checks on what the desktop app is built from:
# 1. No library that can speak a network protocol is compiled in.
# 2. Plugins that could write files or run programs (fs, shell) may be present only as dependencies of another
#    plugin, and the app's permission file must grant them nothing, so the interface can never use them.
set -euo pipefail
cd "$(dirname "$0")/src-tauri"
net='^(reqwest|hyper|hyper-util|ureq|isahc|curl|curl-sys|attohttpc|surf|h2|h3|quinn|rustls|native-tls|openssl|tokio-tungstenite|tungstenite|websocket|tauri-plugin-http|tauri-plugin-updater|tauri-plugin-websocket|tauri-plugin-upload|socket2|mio)$'
tree=$(cargo tree -e normal --prefix none --format '{p}' | awk '{print $1}' | sort -u)
echo "$(wc -l <<<"$tree") crates in the normal dependency graph"
found=$(grep -E "$net" <<<"$tree" || true)
if [ -n "$found" ]; then
  echo "FAIL: networking crates present:"; echo "$found"
  for c in $found; do cargo tree -e normal -i "$c" | head -8; done
  exit 1
fi
echo "OK: no networking crate is compiled in"
if grep -RqE '"(fs|shell|http|process|updater):' capabilities/; then
  echo "FAIL: a capability grants fs, shell, http, process or updater permissions:"
  grep -RnE '"(fs|shell|http|process|updater):' capabilities/
  exit 1
fi
echo "OK: the interface is granted no file-writing, shell or network permission"
