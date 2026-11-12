#!/usr/bin/env bash
# The nightly job (docs/operations/backup-and-restore.md): one backup, one line in the log, an alert when it
# fails. Started by the timer in systemd/ or by cron; never more than one at a time.
#
#   run-scheduled.sh <settings file>
#
# The settings file is the one of backup.sh plus R2's (backup.env.example, r2.env.example) and, for this job:
#   BACKUP_LOG            the log file (default $BACKUP_DIR/backup.log): one line per run, no data, no setting
#   BACKUP_ALERT_CMD      run as `$BACKUP_ALERT_CMD "<subject>" "<one line>"` when a run fails
#   BACKUP_HEARTBEAT_URL  optional: fetched after each SUCCESS, for a monitor outside this host that raises the
#                         alarm when the fetches stop (a host that is down cannot send its own alert)
. "$(dirname "$0")/lib.sh"
settings="${1:-}"
[ -r "$settings" ] || die "usage: run-scheduled.sh <settings file>"
case "$(ls -l "$settings" | cut -c5-10)" in ------) ;; *) die "the settings file must be readable by its owner only (chmod 600)" ;; esac
set -a; . "$settings"; set +a
: "${BACKUP_DIR:?set BACKUP_DIR}"
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
log="${BACKUP_LOG:-$BACKUP_DIR/backup.log}"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
alert() { [ -z "${BACKUP_ALERT_CMD:-}" ] || $BACKUP_ALERT_CMD "$1" "$2" >/dev/null 2>&1 || echo "$(now) ALERT-NOT-SENT $1" >> "$log"; }

# One run at a time. The lock is a directory holding the pid; a lock whose process is gone is taken over.
lock="$BACKUP_DIR/.lock"
if ! mkdir "$lock" 2>/dev/null; then
  holder=$(cat "$lock/pid" 2>/dev/null || true)
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    echo "$(now) SKIPPED another backup is running" >> "$log"
    die "another backup is running"
  fi
  rm -rf "$lock" && mkdir "$lock" || die "the lock could not be taken"
fi
echo $$ > "$lock/pid"
trap 'rm -rf "$lock"' EXIT

# `set -e` is on: the failure is caught here, or it would end this script before it is logged and alerted.
code=0
out=$("$(dirname "$0")/backup.sh" 2>&1) || code=$?
last=$(printf '%s\n' "$out" | grep -v '^$' | tail -1)
if [ $code -eq 0 ]; then
  id="$last"
  bytes=$(sed -n 's/^bytes|//p' "$BACKUP_DIR/$id.manifest" 2>/dev/null | head -1)
  echo "$(now) OK $id ${bytes:-?} bytes" >> "$log"
  date -u +%s > "$BACKUP_DIR/last-success"
  [ -z "${BACKUP_HEARTBEAT_URL:-}" ] || curl -fsS --max-time 20 -o /dev/null "$BACKUP_HEARTBEAT_URL" 2>/dev/null || echo "$(now) HEARTBEAT-NOT-SENT" >> "$log"
  echo "$id"
else
  # The reason is the script's own last line: a cause, never a value.
  reason=$(printf '%s' "$last" | sed 's/^[^:]*: FAILED: //' | cut -c1-200)
  echo "$(now) FAILED $reason" >> "$log"
  alert "SmileSim backup FAILED" "$(now) $reason"
  exit 1
fi
