#!/usr/bin/env bash
# Takes one encrypted backup of the SmileSim database (docs/operations/backup-and-restore.md).
#
#   scripts/backup/backup.sh            a routine backup (the service may be running)
#   scripts/backup/backup.sh --final    the backup before an upgrade or a rollback: refuses unless nothing wrote
#                                       to the database while it was taken
#
# What it does, in one consistent snapshot of the database:
#   1. `pg_dump --format=custom` runs INSIDE the postgres container and is piped straight into `gpg --encrypt`
#      there. The dump never exists unencrypted, on any disk or outside that container.
#   2. It is encrypted to a PUBLIC key. This host holds no key that opens a backup.
#   3. The fingerprint of the database (row counts, a checksum of every table's content, the migrations, the
#      constraints) is taken in the same snapshot, so a restore can be compared with exactly what was dumped.
#   4. The encrypted file is checked (not empty, a well-formed OpenPGP message, its SHA-256 recorded), then handed
#      to the upload command. Only after a successful upload are old local copies pruned.
#
# Settings (environment; nothing secret is needed to take a backup):
#   BACKUP_PG_CONTAINER   the postgres container's name
#   BACKUP_PUBLIC_KEY     path to the OpenPGP public key the backups are encrypted to
#   BACKUP_DIR            where the encrypted files and their manifests are kept locally
#   BACKUP_UPLOAD_CMD     command run as `$BACKUP_UPLOAD_CMD <file> <manifest>`; must exit 0 only when BOTH are
#                         stored off this host. Unset: the backup is kept locally and marked `not uploaded`,
#                         which --final refuses.
#   BACKUP_KEEP_LOCAL     how many local backups to keep (default 7)
#   BACKUP_MIN_FREE_MB    refuse under this much free space in BACKUP_DIR (default 2048)
#   BACKUP_FINGERPRINT    full (default) | counts
#   BACKUP_DB / BACKUP_DB_USER   default: the container's own POSTGRES_DB / POSTGRES_USER
#
# Exit code 0: a verified backup exists (and was uploaded, when an upload command is set). Anything else: no
# usable backup was made; the reason is the last line on stderr. Nothing of the data, and no setting's value, is
# printed.
. "$(dirname "$0")/lib.sh"
need docker

final=0
[ "${1:-}" = "--final" ] && final=1
[ $# -le 1 ] || die "usage: backup.sh [--final]"
[ "${1:-}" = "" ] || [ $final -eq 1 ] || die "usage: backup.sh [--final]"

: "${BACKUP_PG_CONTAINER:?set BACKUP_PG_CONTAINER}"
: "${BACKUP_PUBLIC_KEY:?set BACKUP_PUBLIC_KEY}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
keep="${BACKUP_KEEP_LOCAL:-7}"
min_free="${BACKUP_MIN_FREE_MB:-2048}"
mode="${BACKUP_FINGERPRINT:-full}"
[ "$mode" = full ] || [ "$mode" = counts ] || die "BACKUP_FINGERPRINT must be full or counts"
[ -r "$BACKUP_PUBLIC_KEY" ] || die "the public key file cannot be read"
grep -q "BEGIN PGP PUBLIC KEY BLOCK" "$BACKUP_PUBLIC_KEY" || die "BACKUP_PUBLIC_KEY is not an OpenPGP public key"
! grep -q "PRIVATE KEY" "$BACKUP_PUBLIC_KEY" || die "BACKUP_PUBLIC_KEY holds a private key: this host must not have one"
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
free_mb=$(df -Pm "$BACKUP_DIR" | awk 'NR==2 {print $4}')
[ "$free_mb" -ge "$min_free" ] || die "only ${free_mb} MB free in the backup directory (needs ${min_free})"
docker exec "$BACKUP_PG_CONTAINER" sh -c 'command -v pg_dump >/dev/null && command -v gpg >/dev/null && command -v psql >/dev/null' \
  || die "the postgres container is not running, or lacks pg_dump / gpg / psql"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
id="smilesim-${stamp}"
file="$BACKUP_DIR/$id.dump.gpg"
manifest="$BACKUP_DIR/$id.manifest"
partial="$file.partial"
trap 'rm -f "$partial" "$manifest.partial"; docker exec "$BACKUP_PG_CONTAINER" rm -rf /tmp/smilesim-backup >/dev/null 2>&1 || true' EXIT

# The public key and the session script go into the container; neither is secret.
docker exec "$BACKUP_PG_CONTAINER" sh -c 'rm -rf /tmp/smilesim-backup && mkdir -m 700 /tmp/smilesim-backup'
docker exec -i "$BACKUP_PG_CONTAINER" sh -c 'cat > /tmp/smilesim-backup/public.asc' < "$BACKUP_PUBLIC_KEY"

# Activity counters before: every row inserted, updated or deleted since the server started.
writes() {
  docker exec -e BACKUP_DB="${BACKUP_DB:-}" -e BACKUP_DB_USER="${BACKUP_DB_USER:-}" "$BACKUP_PG_CONTAINER" sh -c 'psql -X -qAt -v ON_ERROR_STOP=1 -U "${BACKUP_DB_USER:-$POSTGRES_USER}" -d "${BACKUP_DB:-$POSTGRES_DB}" -c "select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) from pg_stat_user_tables"' 
}
others() {
  docker exec -e BACKUP_DB="${BACKUP_DB:-}" -e BACKUP_DB_USER="${BACKUP_DB_USER:-}" "$BACKUP_PG_CONTAINER" sh -c 'psql -X -qAt -v ON_ERROR_STOP=1 -U "${BACKUP_DB_USER:-$POSTGRES_USER}" -d "${BACKUP_DB:-$POSTGRES_DB}" -c "select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and backend_type = '"'"'client backend'"'"'"'
}
writes_before=$(writes) || die "the database cannot be read"
if [ $final -eq 1 ]; then
  open=$(others)
  [ "$open" = "0" ] || die "--final: $open other session(s) are connected to the database; stop the API and the worker first"
fi

# One session holds one snapshot: the fingerprint is read in it and pg_dump is told to use the same one.
# psql writes the fingerprint to a file in the container (\o); its own stdout carries only the encrypted dump.
docker exec -i -e FP_MODE="$mode" -e BACKUP_DB="${BACKUP_DB:-}" -e BACKUP_DB_USER="${BACKUP_DB_USER:-}" "$BACKUP_PG_CONTAINER" sh -c '
  set -eu
  export PGDATABASE="${BACKUP_DB:-$POSTGRES_DB}" PGUSER="${BACKUP_DB_USER:-$POSTGRES_USER}"
  export GNUPGHOME=/tmp/smilesim-backup/gnupg; mkdir -m 700 "$GNUPGHOME"
  cat > /tmp/smilesim-backup/dump.sh <<"SH"
set -eu
set -o pipefail 2>/dev/null || true
pg_dump --format=custom --no-owner --no-privileges --snapshot="$SNAPSHOT" \
  | gpg --batch --yes --quiet --no-tty --trust-model always --compress-algo none --cipher-algo AES256 \
        --recipient-file /tmp/smilesim-backup/public.asc --encrypt
SH
  psql -X -q -v ON_ERROR_STOP=1 -v mode="$FP_MODE" -At -F "|" -f - <<SQL
begin isolation level repeatable read read only;
select pg_export_snapshot() as snapshot \gset
\setenv SNAPSHOT :snapshot
\o /tmp/smilesim-backup/fingerprint
select \$\$server|\$\$ || current_setting(\$\$server_version\$\$);
$(cat)
\o
\! bash /tmp/smilesim-backup/dump.sh || echo DUMP-FAILED >> /tmp/smilesim-backup/failed
commit;
SQL
  [ ! -e /tmp/smilesim-backup/failed ]
' > "$partial" < "$FINGERPRINT_SQL_FILE" || die "the dump or its encryption failed; no backup was written"

writes_after=$(writes) || die "the database cannot be read after the dump"
docker exec "$BACKUP_PG_CONTAINER" cat /tmp/smilesim-backup/fingerprint > "$manifest.partial.fp" || die "the fingerprint could not be read"
trap 'rm -f "$partial" "$manifest.partial" "$manifest.partial.fp"; docker exec "$BACKUP_PG_CONTAINER" rm -rf /tmp/smilesim-backup >/dev/null 2>&1 || true' EXIT

# Checks on what was written. An empty or cut file is the usual way a backup turns out useless.
size=$(wc -c < "$partial" | tr -d ' ')
[ "$size" -gt 1024 ] || die "the encrypted file is ${size} bytes: too small to be a dump"
# Without the private key gpg cannot open it (by design) and says so with a non-zero exit, but it still names the
# packets: a message encrypted to a public key starts with a `pubkey enc packet`. That it opens is proved by
# verify-restore.sh, where the private key is.
docker exec -i "$BACKUP_PG_CONTAINER" sh -c 'GNUPGHOME=/tmp/smilesim-backup/gnupg gpg --batch --no-tty --list-packets 2>/dev/null | grep -q "^:pubkey enc packet:"' < "$partial" \
  || die "the encrypted file is not an OpenPGP message encrypted to a public key"
[ -s "$manifest.partial.fp" ] || die "the fingerprint is empty"
grep -q '^table|' "$manifest.partial.fp" || die "the fingerprint lists no table"
sum=$(sha256_of "$partial")
quiet=yes
[ "$writes_before" = "$writes_after" ] || quiet=no
if [ $final -eq 1 ] && [ "$quiet" = no ]; then
  die "--final: rows were written while the backup was taken ($writes_before -> $writes_after); stop the writers and take it again"
fi

{
  echo "id|$id"
  echo "taken|$stamp"
  echo "kind|$([ $final -eq 1 ] && echo final || echo routine)"
  echo "file|$id.dump.gpg"
  echo "bytes|$size"
  echo "sha256|$sum"
  echo "fingerprint-mode|$mode"
  echo "quiet-while-taken|$quiet"
  echo "tables|$(grep -c '^table|' "$manifest.partial.fp")"
  echo "migrations|$(grep -c '^migration|' "$manifest.partial.fp")"
  echo "--- fingerprint"
  LC_ALL=C sort "$manifest.partial.fp"
} > "$manifest.partial"
rm -f "$manifest.partial.fp"
mv "$partial" "$file"
mv "$manifest.partial" "$manifest"
chmod 600 "$file" "$manifest"
say "backup $id: $size bytes, sha256 $sum, $(grep -c '^table|' "$manifest") tables, quiet while taken: $quiet"

# Off this host. A backup that exists only here does not count.
if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  $BACKUP_UPLOAD_CMD "$file" "$manifest" || die "the upload failed; the backup is kept locally as $id and is NOT off this host"
  echo "uploaded|$(date -u +%Y%m%dT%H%M%SZ)" >> "$manifest"
  say "uploaded $id"
  # Old local copies go only now, and never the one just made.
  ls -1 "$BACKUP_DIR"/smilesim-*.dump.gpg 2>/dev/null | LC_ALL=C sort -r | awk -v keep="$keep" 'NR > keep' | while read -r old; do
    rm -f "$old" "${old%.dump.gpg}.manifest"
  done
else
  [ $final -eq 0 ] || die "--final: no BACKUP_UPLOAD_CMD is set, so the backup would exist only on this host"
  say "kept locally only (no BACKUP_UPLOAD_CMD): this is not yet a backup off the host"
fi
echo "$id"
