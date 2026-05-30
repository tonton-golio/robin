#!/usr/bin/env bash
# Daily-log hook.
# Runs at SessionEnd. Appends a minimal session-summary line to a per-day log.
# Designed to be safe (file-locked, non-recursive, fast).
#
# This is a *minimal* version. A fuller implementation could pipe the session
# transcript (read from $CLAUDE_HOOK_INPUT JSON on stdin) into a headless LLM
# call to produce a structured summary. Start simple; add depth when you need it.

set -u

# Prevent recursion if a fuller implementation spawns Claude headless calls.
if [ "${ROBIN_DAILY_LOG_ACTIVE:-}" = "1" ]; then
  exit 0
fi
export ROBIN_DAILY_LOG_ACTIVE=1

VAULT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
LOG_DIR="$VAULT/logs/daily"
mkdir -p "$LOG_DIR"

today=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/$today.md"
LOCK_FILE="$LOG_DIR/.$today.lock"

# Simple lock to avoid concurrent writes.
exec 9>"$LOCK_FILE" 2>/dev/null
if ! flock -n 9 2>/dev/null; then
  # If flock isn't available or another process holds the lock, just skip.
  exit 0
fi

timestamp=$(date +%H:%M:%S)
echo "- $timestamp — session ended" >> "$LOG_FILE"

exit 0
