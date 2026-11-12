#!/usr/bin/env bash
# The ways a backup or a restore must FAIL, tried on synthetic data (docs/operations/backup-and-restore.md).
# Needs the settings of backup.sh and verify-restore.sh pointing at a synthetic database and a TEST key pair, a
# verified backup already in BACKUP_DIR, and WRONG_PRIVATE_KEY (another test key). Prints one line per case.
set -u
here="$(cd "$(dirname "$0")/.." && pwd)"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
file=$(ls -1 "$BACKUP_DIR"/smilesim-*.dump.gpg | sort | tail -1); manifest="${file%.dump.gpg}.manifest"
pass=0; bad=0
expect_fail() { # name, expected text, command...
  name="$1"; text="$2"; shift 2
  out=$("$@" 2>&1); code=$?
  if [ $code -ne 0 ] && echo "$out" | grep -q "$text"; then echo "ok    refused: $name"; pass=$((pass+1)); else echo "WRONG $name (exit $code): $(echo "$out" | tail -1)"; bad=$((bad+1)); fi
}
expect_ok() { name="$1"; text="$2"; shift 2; out=$("$@" 2>&1); code=$?
  if [ $code -eq 0 ] && echo "$out" | grep -q "$text"; then echo "ok    $name"; pass=$((pass+1)); else echo "WRONG $name (exit $code): $(echo "$out" | tail -1)"; bad=$((bad+1)); fi; }
psql_src() { docker exec -i "$BACKUP_PG_CONTAINER" psql -X -qAt -U "${BACKUP_DB_USER:-smilesim}" -d "$BACKUP_DB" "$@"; }

# --- verify-restore ---
cp "$file" "$work/t.gpg"; cp "$manifest" "$work/t.manifest"
size=$(wc -c < "$work/t.gpg" | tr -d ' ')
printf '\377' | dd of="$work/t.gpg" bs=1 seek=$((size / 2)) conv=notrunc 2>/dev/null
expect_fail "a file changed after it was written" "SHA-256 differs" "$here/verify-restore.sh" "$work/t.gpg" "$work/t.manifest"
sum=$( (sha256sum "$work/t.gpg" 2>/dev/null || shasum -a 256 "$work/t.gpg") | cut -d' ' -f1)
sed "s/^sha256|.*/sha256|$sum/" "$manifest" > "$work/t.manifest"
expect_fail "a damaged file whose manifest was rewritten to match" "could not be decrypted and restored" "$here/verify-restore.sh" "$work/t.gpg" "$work/t.manifest"
head -c $((size / 2)) "$file" > "$work/cut.gpg"; sum=$( (sha256sum "$work/cut.gpg" 2>/dev/null || shasum -a 256 "$work/cut.gpg") | cut -d' ' -f1)
sed "s/^sha256|.*/sha256|$sum/" "$manifest" > "$work/cut.manifest"
expect_fail "a file cut short" "could not be decrypted and restored" "$here/verify-restore.sh" "$work/cut.gpg" "$work/cut.manifest"
expect_fail "another private key" "could not be decrypted and restored" env BACKUP_PRIVATE_KEY="$WRONG_PRIVATE_KEY" "$here/verify-restore.sh" "$file" "$manifest"
awk -F'|' 'BEGIN{OFS="|"} /^table\|Line\|/ {$3=$3+1} {print}' "$manifest" > "$work/count.manifest"
expect_fail "a manifest that records one more line than the dump holds" "verification of" "$here/verify-restore.sh" "$file" "$work/count.manifest"
awk -F'|' 'BEGIN{OFS="|"} /^table\|WalletEntry\|/ {$4="00000000000000000000000000000000"} {print}' "$manifest" > "$work/sum.manifest"
expect_fail "a manifest whose ledger checksum differs (same row count)" "verification of" "$here/verify-restore.sh" "$file" "$work/sum.manifest"
grep -v '^migration|' "$manifest" > "$work/mig.manifest"
expect_fail "a manifest with no migrations recorded" "verification of" "$here/verify-restore.sh" "$file" "$work/mig.manifest"
expect_ok "the untouched backup verifies" "^VERIFIED " "$here/verify-restore.sh" "$file" "$manifest"

# --- backup ---
expect_fail "a private key given as the public key" "public key" env BACKUP_PUBLIC_KEY="$BACKUP_PRIVATE_KEY" "$here/backup.sh"
expect_fail "too little free space" "MB free" env BACKUP_MIN_FREE_MB=999999999 "$here/backup.sh"
expect_fail "a container that is not there" "not running" env BACKUP_PG_CONTAINER=no-such-container "$here/backup.sh"
expect_fail "a database that is not there" "FAILED" env BACKUP_DB=no_such_database "$here/backup.sh"
before=$(ls -1 "$BACKUP_DIR" | wc -l | tr -d ' ')
expect_fail "an upload that fails" "NOT off this host" env BACKUP_UPLOAD_CMD=false "$here/backup.sh"
kept=$(ls -1 "$BACKUP_DIR" | wc -l | tr -d ' ')
[ "$kept" -gt "$before" ] && { echo "ok    after a failed upload the new backup is kept locally and nothing was pruned"; pass=$((pass+1)); } || { echo "WRONG local files after a failed upload"; bad=$((bad+1)); }
expect_fail "--final with no upload command" "would exist only on this host" env BACKUP_UPLOAD_CMD= "$here/backup.sh" --final
# A session left open, as the API or the worker would hold one.
docker exec -d "$BACKUP_PG_CONTAINER" psql -X -q -U "${BACKUP_DB_USER:-smilesim}" -d "$BACKUP_DB" -c "select pg_sleep(20)"
sleep 2
expect_fail "--final while another session is connected" "other session" "$here/backup.sh" --final
sleep 20
expect_ok "--final with the database quiet" "quiet while taken: yes" "$here/backup.sh" --final

# --- a routine backup while rows are written: still one consistent snapshot ---
( for i in $(seq 1 400); do psql_src -c "insert into \"Notice\" (id, \"userId\", kind, href) values ('busy-' || clock_timestamp()::text || '-$i', 'u-pos1', 'task', '/tasks'); update \"Wallet\" set balance = balance - 1 where \"userId\" = 'u-pos1'; insert into \"WalletEntry\" (id, \"userId\", \"actorId\", amount, \"balanceAfter\", kind) select 'busy-entry-' || clock_timestamp()::text || '-$i', 'u-pos1', 'u-pos1', -1, balance, 'charge' from \"Wallet\" where \"userId\" = 'u-pos1'" >/dev/null 2>&1; done ) &
writer=$!
sleep 1
out=$("$here/backup.sh" 2>&1); code=$?
busy_id=$(echo "$out" | tail -1)
kill $writer 2>/dev/null; wait $writer 2>/dev/null
if [ $code -eq 0 ] && echo "$out" | grep -q "quiet while taken: no"; then echo "ok    a backup taken while rows were written says so"; pass=$((pass+1)); else echo "WRONG backup under writes (exit $code): $(echo "$out" | tail -2 | head -1)"; bad=$((bad+1)); fi
expect_ok "and it restores to exactly its own snapshot (dump and fingerprint agree)" "^VERIFIED " "$here/verify-restore.sh" "$BACKUP_DIR/$busy_id.dump.gpg" "$BACKUP_DIR/$busy_id.manifest"
# The ledger in that snapshot is whole: every busy entry has its wallet move (balance and entries moved together).
echo "passed $pass, wrong $bad"
[ $bad -eq 0 ]
