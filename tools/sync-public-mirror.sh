#!/usr/bin/env bash
# Publishes the committed source (HEAD) to the public, read-only mirror, as one new commit by a neutral author.
# The mirror has its own history, so this repo's commit authors and messages never appear there.
# Left out: internal launch and legal-planning docs, and the Store artwork. Links to them are turned into plain text.
#   tools/sync-public-mirror.sh            build the mirror in a temp folder, show what changed, and push
#   DRY_RUN=1 tools/sync-public-mirror.sh  build and show, don't push
set -euo pipefail

MIRROR=${MIRROR:-joyfulmake/locatorzero-source}
AUTHOR_NAME="LocatorZero"
AUTHOR_EMAIL="locatorzero.help@gmail.com"
EXCLUDE=(docs/launch-kit.md docs/launch-plan.md docs/publishing-steps.md docs/legal-brief.md docs/store-assets)
# Anything personal that must never reach the mirror. The scan fails the sync if one appears.
FORBIDDEN="sri""ram|c76""@|/home/kali/""dev"   # split so this file does not match itself

root=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
if [ -n "$(git -C "$root" status --porcelain)" ]; then
  echo "note: uncommitted changes are not published; only HEAD is"
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if git ls-remote "https://github.com/$MIRROR.git" >/dev/null 2>&1 && [ -n "$(git ls-remote "https://github.com/$MIRROR.git")" ]; then
  git clone -q "https://github.com/$MIRROR.git" "$work/m"
else
  git init -q -b main "$work/m"
  git -C "$work/m" remote add origin "https://github.com/$MIRROR.git"
fi
m="$work/m"

# Replace the tree with HEAD's files.
find "$m" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git -C "$root" archive HEAD | tar -x -C "$m"
for p in "${EXCLUDE[@]}"; do rm -rf "${m:?}/$p"; done

python3 - "$m" "${EXCLUDE[@]}" <<'EOF'
import os, re, sys
m, excluded = sys.argv[1], sys.argv[2:]
pat = '|'.join(re.escape(p) for p in excluded)
for dirpath, _, files in os.walk(m):
    if '.git' in dirpath.split(os.sep): continue
    for f in files:
        if not f.endswith('.md'): continue
        p = os.path.join(dirpath, f)
        s = open(p, encoding='utf-8').read()
        out = []
        for line in s.split('\n'):
            # A table row that exists only to point at an excluded doc goes; other links become plain text.
            if line.startswith('| [') and re.match(r'^\| \[[^\]]*\]\((?:\.\./)?(?:%s)[^)]*\) \|' % pat, line): continue
            out.append(re.sub(r'\[([^\]]+)\]\((?:\.\./)?(?:%s)[^)]*\)' % pat, r'\1', line))
        t = '\n'.join(out)
        if t != s: open(p, 'w', encoding='utf-8').write(t)
EOF

if grep -rIlE "$FORBIDDEN" --exclude-dir=.git "$m"; then
  echo "stopped: the files above contain personal details" >&2; exit 1
fi
left=$(grep -rIlE 'launch-kit|launch-plan|publishing-steps|legal-brief' --exclude-dir=.git --include='*.md' "$m" || true)
[ -z "$left" ] || echo "note: excluded docs still named (as plain text) in: $left"

git -C "$m" add -A
if git -C "$m" diff --cached --quiet; then echo "mirror already up to date"; exit 0; fi
git -C "$m" diff --cached --stat | tail -3
version=$(node -p "require('$root/desktop/src-tauri/tauri.conf.json').version")
GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git -C "$m" -c commit.gpgsign=false commit -q -m "LocatorZero $version source, $(date -u +%Y-%m-%d)"
git -C "$m" log --format='%an <%ae>  %s' | sort -u | head -5

if [ "${DRY_RUN:-}" = 1 ]; then echo "dry run: not pushed ($m is removed on exit)"; exit 0; fi
git -C "$m" push -q origin main
echo "pushed to https://github.com/$MIRROR"
