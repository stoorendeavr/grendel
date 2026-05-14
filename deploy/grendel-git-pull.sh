#!/bin/bash
# Periodic git pull for the production tunnel host. When new commits land on
# origin/main, pull them; `node --watch` in the server
# launchd job will see the file change and restart automatically.

set -e

REPO=/Users/shauryasagents/Code/grendel
BRANCH=main
LOG=/tmp/grendel-gitpull.log

export PATH=/opt/homebrew/bin:/usr/bin:/bin

cd "$REPO"

# fetch quietly; bail on network error rather than crashing the launchd job
if ! git fetch origin "$BRANCH" --quiet 2>>"$LOG"; then
  echo "[$(date -u +%FT%TZ)] fetch failed" >>"$LOG"
  exit 0
fi

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/"$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "[$(date -u +%FT%TZ)] pulling $LOCAL → $REMOTE" >>"$LOG"
git reset --hard origin/"$BRANCH" >>"$LOG" 2>&1

# If package.json changed, refresh production deps
if git diff --name-only "$LOCAL" "$REMOTE" | grep -q '^package.json$'; then
  echo "[$(date -u +%FT%TZ)] package.json changed — npm ci --omit=dev" >>"$LOG"
  npm ci --omit=dev --no-audit --no-fund >>"$LOG" 2>&1 || true
fi

# Touch the entrypoint so `node --watch` is guaranteed to restart even if the
# changed file was outside its watch graph.
touch server.js
