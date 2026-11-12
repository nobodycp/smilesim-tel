#!/usr/bin/env bash
# The periodic restore drill (docs/operations/backup-and-restore.md): fetches the newest backup from R2 and
# proves it restores. For a machine that is NOT the production host and that holds the private key and a
# read-only R2 credential; meant to be run weekly, by hand or by that machine's own scheduler.
#
#   verify-latest.sh <settings file>     R2_* (read-only token), BACKUP_PRIVATE_KEY, optional
#                                        BACKUP_KEY_PASSPHRASE_FILE, VERIFY_LOG, BACKUP_ALERT_CMD
. "$(dirname "$0")/lib.sh"
settings="${1:-}"
[ -r "$settings" ] || die "usage: verify-latest.sh <settings file>"
set -a; . "$settings"; set +a
here="$(dirname "$0")"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
log="${VERIFY_LOG:-$HOME/smilesim-restore-drills.log}"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
fail() { echo "$(now) FAILED $1" >> "$log"; [ -z "${BACKUP_ALERT_CMD:-}" ] || $BACKUP_ALERT_CMD "SmileSim restore drill FAILED" "$1" >/dev/null 2>&1 || true; die "$1"; }
path=$("$here/r2-fetch.sh" latest "$work" 2>"$work/err" | tail -1) || fail "the newest backup could not be fetched: $(sed 's/^[^:]*: FAILED: //' "$work/err" | tail -1 | cut -c1-160)"
out=$("$here/verify-restore.sh" "$path.dump.gpg" "$path.manifest" 2>"$work/err") || fail "$(basename "$path") did not verify: $(sed 's/^[^:]*: FAILED: //' "$work/err" | tail -1 | cut -c1-160)"
echo "$(now) $out" >> "$log"
echo "$out"
