#!/usr/bin/env bash
# Stage the installers from a successful CI run in web/downloads, with checksums and a manifest the download page
# reads. Then deploy the site as usual. Files over Cloudflare Pages' 25 MB limit (the AppImage) are left out.
#   tools/publish-downloads.sh [run-id]     (default: the latest successful run on main)
set -euo pipefail
cd "$(dirname "$0")/.."
# Installers are built in the public source repo (free CI minutes, and anyone can see what each build came from).
repo=${REPO:-joyfulmake/locatorzero-source}
run=${1:-$(gh run list --repo "$repo" --workflow installers.yml --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId')}
sha=$(gh run view "$run" --repo "$repo" --json headSha --jq .headSha)

# A published version is frozen: winget, the AUR and anyone who noted a fingerprint rely on its files never changing.
# To publish new installers, bump "version" in desktop/src-tauri/tauri.conf.json first (or set FORCE=1 knowingly).
version=$(node -p "require('./desktop/src-tauri/tauri.conf.json').version")
live=$(curl -fsS https://locatorzero.pages.dev/downloads/manifest.js 2>/dev/null || true)
live_version=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' <<<"$live" | head -1)
live_commit=$(sed -n 's/.*"commit": "\([^"]*\)".*/\1/p' <<<"$live" | head -1)
if [ "$live_version" = "$version" ] && [ -n "$live_commit" ] && [ "$live_commit" != "${sha:0:7}" ] && [ "${FORCE:-0}" != 1 ]; then
  echo "Version $version is already published (from commit $live_commit). Its files are frozen."
  echo "Bump \"version\" in desktop/src-tauri/tauri.conf.json to publish this build, or run with FORCE=1."
  exit 1
fi
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
echo "Fetching installers from run $run (commit ${sha:0:7})"
gh run download "$run" --repo "$repo" -D "$tmp"
rm -rf web/downloads; mkdir -p web/downloads
find "$tmp" -type f \( -name '*.deb' -o -name '*.rpm' -o -name '*.msi' -o -name '*-setup.exe' -o -name '*.dmg' \) -size -25M -exec cp {} web/downloads/ \;
skipped=$(find "$tmp" -type f -size +25M -printf '%f ' || true)
if [ -n "$skipped" ]; then echo "Left out (over 25 MB): $skipped"; fi
(cd web/downloads && sha256sum * > SHA256SUMS.txt)
# Sign the checksum list with the release key (free; proves the files are ours). The key stays in the private repo.
export GNUPGHOME="${LZ_GNUPGHOME:-$PWD/../locatorzero-private/secrets/gnupg}"
if gpg --list-secret-keys "LocatorZero release signing" >/dev/null 2>&1; then
  gpg --batch --yes --pinentry-mode loopback --passphrase '' --armor --detach-sign -u "LocatorZero release signing" \
    -o web/downloads/SHA256SUMS.txt.asc web/downloads/SHA256SUMS.txt
  gpg --verify web/downloads/SHA256SUMS.txt.asc web/downloads/SHA256SUMS.txt 2>&1 | grep -q 'Good signature' && echo "Signed SHA256SUMS.txt"
else
  echo "WARNING: release signing key not found; SHA256SUMS.txt is not signed"
fi
node tools/make-download-manifest.mjs "$run" "$sha"
ls -la web/downloads
