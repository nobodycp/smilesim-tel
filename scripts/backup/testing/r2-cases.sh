#!/usr/bin/env bash
# The R2 path and the scheduled job, tried on synthetic data against the local stand-in (fake-s3.mjs).
# Nothing here reaches Cloudflare. Needs: W (a scratch directory holding keys/test-public.asc,
# keys/test-private.asc, keys/other-private.asc), a synthetic database `smilesim_bk_src` on PG (a container).
set -u
: "${W:?}" "${PG:?}"
here="$(cd "$(dirname "$0")/.." && pwd)"
port=39412; id_key=TESTKEYID0000000002; secret=test-secret-not-real-111111111111
pass=0; bad=0
ok() { echo "ok    $1"; pass=$((pass+1)); }
wrong() { echo "WRONG $1"; bad=$((bad+1)); }
check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else wrong "$1"; fi; }
fake_pid=""
start_fake() { [ -z "$fake_pid" ] || kill "$fake_pid" 2>/dev/null; sleep 0.3; env "$@" node "$here/testing/fake-s3.mjs" $port "$W/r2b" $id_key $secret >/dev/null 2>&1 & fake_pid=$!; sleep 0.8; }
stop_fake() { [ -z "$fake_pid" ] || kill "$fake_pid" 2>/dev/null; fake_pid=""; sleep 0.3; }
trap 'stop_fake; [ -z "${hb_pid:-}" ] || kill $hb_pid 2>/dev/null' EXIT
rm -rf "$W/r2b" "$W/store2" "$W/fetch2" "$W/alerts" && mkdir -p "$W/r2b" "$W/store2"
cat > "$W/alert.sh" <<A
#!/bin/sh
printf '%s | %s\n' "\$1" "\$2" >> "$W/alerts"
A
chmod +x "$W/alert.sh"
write_env() { cat > "$W/job.env" <<E
BACKUP_PG_CONTAINER=$PG
BACKUP_PUBLIC_KEY=$W/keys/test-public.asc
BACKUP_DIR=$W/store2
BACKUP_DB=smilesim_bk_src
BACKUP_UPLOAD_CMD=$here/r2-upload.sh
BACKUP_MIN_FREE_MB=500
BACKUP_ALERT_CMD=$W/alert.sh
R2_ENDPOINT=http://127.0.0.1:$port
R2_BUCKET=bk-test
R2_ACCESS_KEY_ID=${1:-$id_key}
R2_SECRET_ACCESS_KEY=$secret
R2_TRIES=3
$2
E
chmod 600 "$W/job.env"; }
r2env() { env R2_ENDPOINT=http://127.0.0.1:$port R2_BUCKET=bk-test R2_ACCESS_KEY_ID=$id_key R2_SECRET_ACCESS_KEY=$secret R2_TRIES=3 "$@"; }
stored() { find "$W/r2b" -name '*.dump.gpg' | wc -l | tr -d ' '; }

# 1. A scheduled run stores an encrypted backup, and only that.
start_fake; write_env "" ""
id1=$("$here/run-scheduled.sh" "$W/job.env" 2>/dev/null | tail -1)
check "a scheduled run stores the backup in the bucket (daily and the month's first)" '[ -f "$W/r2b/bk-test/smilesim/daily/$id1.dump.gpg" ] && [ -f "$W/r2b/bk-test/smilesim/monthly/smilesim-$(echo $id1 | cut -c10-15).dump.gpg" ]'
check "what is stored is ciphertext: no dump header, no row of the data" '! strings "$W/r2b/bk-test/smilesim/daily/$id1.dump.gpg" | grep -q "PGDMP\|SYNTHETIC\|syn-owner"'
check "the stored object is byte for byte the local file" 'cmp -s "$W/store2/$id1.dump.gpg" "$W/r2b/bk-test/smilesim/daily/$id1.dump.gpg"'
check "the log has one line for the run, with no setting and no data" 'grep -q "OK $id1 [0-9]* bytes" "$W/store2/backup.log" && ! grep -q "$secret\|$id_key\|postgres\|syn-" "$W/store2/backup.log"'

# 2. Fetching and restoring on another machine.
fetched=$(r2env "$here/r2-fetch.sh" latest "$W/fetch2" 2>/dev/null | tail -1)
check "the newest backup is fetched and matches its manifest" '[ "$fetched" = "$W/fetch2/$id1" ]'
check "the list names it" 'r2env "$here/r2-fetch.sh" list | grep -qx "$id1"'
out=$(BACKUP_PRIVATE_KEY="$W/keys/test-private.asc" "$here/verify-restore.sh" "$fetched.dump.gpg" "$fetched.manifest" 2>/dev/null | tail -1)
check "it restores with the right private key: every table, constraint and index as recorded" 'echo "$out" | grep -q "^VERIFIED $id1 "'
check "another private key is refused" '! BACKUP_PRIVATE_KEY="$W/keys/other-private.asc" "$here/verify-restore.sh" "$fetched.dump.gpg" "$fetched.manifest"'

# 3. A name is written once.
check "sending the same backup again changes nothing and succeeds" 'r2env "$here/r2-upload.sh" "$W/store2/$id1.dump.gpg" "$W/store2/$id1.manifest" && cmp -s "$W/store2/$id1.dump.gpg" "$W/r2b/bk-test/smilesim/daily/$id1.dump.gpg"'
mkdir -p "$W/forged"; ( cat "$W/store2/$id1.dump.gpg"; echo extra ) > "$W/forged/$id1.dump.gpg"
sum=$( (sha256sum "$W/forged/$id1.dump.gpg" 2>/dev/null || shasum -a 256 "$W/forged/$id1.dump.gpg") | cut -d' ' -f1)
sed "s/^sha256|.*/sha256|$sum/" "$W/store2/$id1.manifest" > "$W/forged/$id1.manifest"
check "another file under an existing name is refused, and the stored one is untouched" '! r2env "$here/r2-upload.sh" "$W/forged/$id1.dump.gpg" "$W/forged/$id1.manifest" && cmp -s "$W/store2/$id1.dump.gpg" "$W/r2b/bk-test/smilesim/daily/$id1.dump.gpg"'
printf 'PGDMP clear dump' > "$W/forged/clear.dump.gpg"; sum=$( (sha256sum "$W/forged/clear.dump.gpg" 2>/dev/null || shasum -a 256 "$W/forged/clear.dump.gpg") | cut -d' ' -f1)
printf 'id|clear\nsha256|%s\n' "$sum" > "$W/forged/clear.manifest"
check "a clear dump is never uploaded" '! r2env "$here/r2-upload.sh" "$W/forged/clear.dump.gpg" "$W/forged/clear.manifest" && [ ! -e "$W/r2b/bk-test/smilesim/daily/clear.dump.gpg" ]'
check "a file that is not the one its manifest describes is not uploaded" '! r2env "$here/r2-upload.sh" "$W/forged/$id1.dump.gpg" "$W/store2/$id1.manifest"'
check "a file with another ending is not uploaded" '! r2env "$here/r2-upload.sh" "$W/store2/$id1.manifest" "$W/store2/$id1.manifest"'

# 4. Trouble on the way.
sleep 1; start_fake FAKE_S3_FAIL_PUTS=2
id2=$("$here/run-scheduled.sh" "$W/job.env" 2>/dev/null | tail -1)
check "two server errors are tried again and the backup is stored" '[ -n "$id2" ] && cmp -s "$W/store2/$id2.dump.gpg" "$W/r2b/bk-test/smilesim/daily/$id2.dump.gpg"'
sleep 1; start_fake FAKE_S3_DROP_PUTS=1
id3=$("$here/run-scheduled.sh" "$W/job.env" 2>/dev/null | tail -1)
check "a connection cut in the middle of an upload is tried again; the stored object is whole" '[ -n "$id3" ] && cmp -s "$W/store2/$id3.dump.gpg" "$W/r2b/bk-test/smilesim/daily/$id3.dump.gpg"'
sleep 1; stop_fake; : > "$W/alerts"; before=$(ls "$W/store2" | grep -c 'dump.gpg$')
"$here/run-scheduled.sh" "$W/job.env" >/dev/null 2>&1; code=$?
check "with the storage unreachable the run fails after its tries" '[ $code -ne 0 ] && grep -q "FAILED .*did not complete after 3 tries" "$W/store2/backup.log"'
check "the backup it made stays on the host, and nothing older was pruned" '[ $(ls "$W/store2" | grep -c "dump.gpg$") -eq $((before + 1)) ]'
check "the failure is alerted, in one line, with no setting and no data" '[ $(wc -l < "$W/alerts") -eq 1 ] && grep -q "SmileSim backup FAILED" "$W/alerts" && ! grep -q "$secret\|$id_key\|syn-" "$W/alerts"'
start_fake; write_env WRONGKEYID000000000 ""; : > "$W/alerts"
"$here/run-scheduled.sh" "$W/job.env" >/dev/null 2>&1; code=$?
check "a wrong credential is refused at once and alerted" '[ $code -ne 0 ] && grep -q "refused the credentials" "$W/store2/backup.log" && [ $(wc -l < "$W/alerts") -eq 1 ]'
write_env "" ""

# 5. One run at a time.
mkdir "$W/store2/.lock"; echo $$ > "$W/store2/.lock/pid"; n=$(stored)
"$here/run-scheduled.sh" "$W/job.env" >/dev/null 2>&1; code=$?
check "a second run while one is running is refused and makes no backup" '[ $code -ne 0 ] && [ $(stored) -eq $n ] && grep -q "SKIPPED another backup is running" "$W/store2/backup.log"'
echo 999999 > "$W/store2/.lock/pid"; sleep 1
check "a lock left by a run that died is taken over" '"$here/run-scheduled.sh" "$W/job.env" && [ ! -e "$W/store2/.lock" ]'
chmod 644 "$W/job.env"
check "a settings file others can read is refused" '! "$here/run-scheduled.sh" "$W/job.env"'
chmod 600 "$W/job.env"

# 6. Freshness and the heartbeat.
: > "$W/alerts"
check "a recent success passes the freshness check" '"$here/check-freshness.sh" "$W/job.env" && [ ! -s "$W/alerts" ]'
echo $(( $(date -u +%s) - 30 * 3600 )) > "$W/store2/last-success"
check "no success for 30 hours raises the alarm" '! "$here/check-freshness.sh" "$W/job.env" && grep -q "STALE" "$W/alerts" && grep -q "STALE no successful backup for 30h" "$W/store2/backup.log"'
rm -f "$W/store2/last-success"; : > "$W/alerts"
check "a host where no backup ever succeeded raises the alarm" '! "$here/check-freshness.sh" "$W/job.env" && grep -q "ever been recorded" "$W/alerts"'
mkdir -p "$W/hb"; ( cd "$W/hb" && python3 -m http.server 39413 --bind 127.0.0.1 > "$W/hb.log" 2>&1 & echo $! > "$W/hb.pid" ); hb_pid=$(cat "$W/hb.pid"); sleep 1
write_env "" "BACKUP_HEARTBEAT_URL=http://127.0.0.1:39413/"; sleep 1
"$here/run-scheduled.sh" "$W/job.env" >/dev/null 2>&1
check "a success fetches the heartbeat address" 'grep -q "GET / " "$W/hb.log"'
write_env "" ""

# 7. The restore drill.
cat > "$W/drill.env" <<E
R2_ENDPOINT=http://127.0.0.1:$port
R2_BUCKET=bk-test
R2_ACCESS_KEY_ID=$id_key
R2_SECRET_ACCESS_KEY=$secret
BACKUP_PRIVATE_KEY=$W/keys/test-private.asc
VERIFY_LOG=$W/drills.log
BACKUP_ALERT_CMD=$W/alert.sh
E
chmod 600 "$W/drill.env"; : > "$W/alerts"
check "the restore drill fetches the newest backup, restores it and records VERIFIED" '"$here/verify-latest.sh" "$W/drill.env" && grep -q " VERIFIED smilesim-" "$W/drills.log" && [ ! -s "$W/alerts" ]'
sed -i.bak "s#test-private.asc#other-private.asc#" "$W/drill.env"
check "a drill that cannot restore is recorded and alerted" '! "$here/verify-latest.sh" "$W/drill.env" && grep -q "FAILED" "$W/drills.log" && grep -q "restore drill FAILED" "$W/alerts"'
echo "passed $pass, wrong $bad"
[ $bad -eq 0 ]
