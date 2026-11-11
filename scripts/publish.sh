#!/usr/bin/env bash
# Fetch a snapshot into a data repo, commit it there (full history stays local), and publish
# only the latest tree to GitHub as a single parentless commit.
# Usage: scripts/publish.sh <calibnet|mainnet>
# Env: LOTUS_API (node RPC, default per network), DATA_DIR (data repo), NO_PUSH=1 (skip the push).
set -euo pipefail

net=${1:?usage: publish.sh <calibnet|mainnet>}
case $net in
  calibnet) repo=filecoin-sector-spiegel-data-calibration ;;
  mainnet) repo=filecoin-sector-spiegel-data-main ;;
  *) echo "unknown network: $net" >&2; exit 2 ;;
esac

APP=$(cd "$(dirname "$0")/.." && pwd)
DATA=${DATA_DIR:-$APP/../$repo}
started=$(date +%s)

# One run per data repo at a time.
exec 9>"$DATA/.git/publish.lock"
flock -n 9 || { echo "$net: another publish is running" >&2; exit 1; }

# The working tree is the previous snapshot, which the history diff compares against.
if [ -n "$(git -C "$DATA" status --porcelain)" ]; then
  echo "$net: $DATA has uncommitted changes" >&2
  exit 1
fi

node "$APP/scripts/fetch-sectors.ts" --out "$DATA" --commit

if [ "${NO_PUSH:-}" = 1 ]; then
  echo "$net: committed locally, push skipped (NO_PUSH=1)"
else
  commit=$(git -C "$DATA" commit-tree 'HEAD^{tree}' -m "$(git -C "$DATA" log -1 --format=%s)")
  git -C "$DATA" push --quiet --force origin "$commit:refs/heads/main"
  echo "$net: published $(git -C "$DATA" log -1 --format=%s) as ${commit:0:7}"
fi
echo "$net: done in $(($(date +%s) - started))s"
