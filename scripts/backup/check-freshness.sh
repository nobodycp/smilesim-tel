#!/usr/bin/env bash
# Raises the alarm when there has been no successful backup for too long, whatever the reason: the job failed,
# never ran, or was never installed. Run by its own timer, apart from the backup's.
#
#   check-freshness.sh <settings file>      BACKUP_MAX_AGE_HOURS (default 26) is the limit
#
# Exit 0: a backup succeeded within the limit. Exit 1: it did not, and the alert was sent.
. "$(dirname "$0")/lib.sh"
settings="${1:-}"
[ -r "$settings" ] || die "usage: check-freshness.sh <settings file>"
set -a; . "$settings"; set +a
: "${BACKUP_DIR:?set BACKUP_DIR}"
limit="${BACKUP_MAX_AGE_HOURS:-26}"
log="${BACKUP_LOG:-$BACKUP_DIR/backup.log}"
now=$(date -u +%s)
last=$(cat "$BACKUP_DIR/last-success" 2>/dev/null || echo 0)
age=$(( (now - last) / 3600 ))
if [ "$last" -gt 0 ] && [ "$age" -lt "$limit" ]; then
  say "the last successful backup was ${age}h ago (limit ${limit}h)"
  exit 0
fi
what="no successful backup for ${age}h (limit ${limit}h)"
[ "$last" -gt 0 ] || what="no successful backup has ever been recorded here"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) STALE $what" >> "$log"
[ -z "${BACKUP_ALERT_CMD:-}" ] || $BACKUP_ALERT_CMD "SmileSim backup is STALE" "$what" >/dev/null 2>&1 || true
die "$what"
