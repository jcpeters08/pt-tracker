#!/usr/bin/env bash
# host_push.sh — host-Mac cleanup + push for PT Tracker.
#
# Purpose: the daily Cowork sandbox sync (scripts/sync.py) commits drained
# entries locally but CANNOT push (no GitHub credentials inside the sandbox).
# It also occasionally leaves stale .git/**/*.lock files that the sandbox
# can't remove (virtiofs permission). This script — run from the host Mac
# where credentials and full filesystem permission both exist — picks up
# the slack.
#
# What it does (in order, all idempotent):
#   1. Removes stale .git/**/*.lock and *.lock.delete files
#   2. Fetches origin
#   3. If local main is ahead of origin/main, pushes
#   4. Reports what happened
#
# Safe to run any time, multiple times. Exits 0 on success or no-op,
# non-zero only on real failures (push rejected, network down, etc.).
#
# Wire it up however suits you — manual after each sync, a launchd
# LaunchAgent every 15 min, a shell alias, whatever. It's just a script.

set -euo pipefail

REPO="${PT_TRACKER_REPO_ROOT:-$HOME/Git/pt-tracker}"
cd "$REPO"

if [[ ! -d .git ]]; then
  echo "ERROR: $REPO is not a git repo" >&2
  exit 2
fi

# Step 1: stale lock cleanup. Both .lock (real locks from interrupted ops)
# and .lock.delete (the rename-workaround residue the sandbox leaves when
# it can't rm the lock files outright).
locks=$(find .git \( -name "*.lock" -o -name "*.lock.delete" \) -type f 2>/dev/null || true)
if [[ -n "$locks" ]]; then
  echo "$locks" | while read -r f; do
    rm -f "$f" && echo "  cleaned: $f"
  done
else
  echo "  no stale locks"
fi

# Step 2: fetch
git fetch --quiet origin

# Step 3: compare local vs remote
local_sha=$(git rev-parse main)
remote_sha=$(git rev-parse origin/main)
ahead=$(git rev-list --count "${remote_sha}..${local_sha}")
behind=$(git rev-list --count "${local_sha}..${remote_sha}")

if [[ "$ahead" == "0" && "$behind" == "0" ]]; then
  echo "  in sync with origin/main"
  exit 0
fi
if [[ "$behind" != "0" ]]; then
  echo "ERROR: local main is $behind commit(s) BEHIND origin/main and $ahead ahead — diverged. Resolve manually." >&2
  exit 3
fi

# Step 4: push
echo "  pushing $ahead commit(s) to origin/main..."
git push origin main
echo "  pushed."
