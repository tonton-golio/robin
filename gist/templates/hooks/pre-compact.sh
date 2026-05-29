#!/usr/bin/env bash
# Pre-compact hook.
# Nudges the user to run /learn before context compaction, if /learn hasn't
# touched the .last-learn sentinel in the past 30 minutes.
#
# This is a non-blocking reminder. Exit code 2 surfaces the message to the
# user without preventing compaction.

set -u

VAULT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
SENTINEL="$VAULT/logs/.last-learn"
THRESHOLD_SECONDS=1800   # 30 minutes

if [ -f "$SENTINEL" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    mtime=$(stat -f %m "$SENTINEL")
  else
    mtime=$(stat -c %Y "$SENTINEL")
  fi
  now=$(date +%s)
  if [ $((now - mtime)) -lt $THRESHOLD_SECONDS ]; then
    exit 0
  fi
fi

echo "Reminder: run /learn before /compact to preserve durable knowledge from this session." >&2
exit 2
