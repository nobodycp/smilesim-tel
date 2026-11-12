#!/usr/bin/env bash
# Proves that a backup can be restored (docs/operations/backup-and-restore.md). Run on a machine that is NOT the
# production host and that holds the private key: it never touches production.
#
#   scripts/backup/verify-restore.sh <file.dump.gpg> <file.manifest> [--keep]
#
#   1. The file's SHA-256 must be the one its manifest records (the file is the one that was written).
#   2. A throwaway PostgreSQL 16 container with no network is started; nothing else can reach it.
#   3. The file is decrypted INSIDE that container and piped straight into `pg_restore`; the dump is never
#      written unencrypted to this machine's disk. Any restore error stops it.
#   4. The restored database's fingerprint is taken and compared, line by line, with the one in the manifest:
#      every table's row count and content checksum, every migration, constraint, index, trigger, column and
#      sequence. One difference fails the verification.
#   5. On success it prints `VERIFIED <id> <sha256>`. That line is the gate: no upgrade step that changes data
#      starts without it for the backup taken just before.
#
# Settings: BACKUP_PRIVATE_KEY (path to the exported private key; never on the production host),
#           BACKUP_KEY_PASSPHRASE_FILE (optional, a file holding the key's passphrase),
#           VERIFY_IMAGE (default postgres:16), VERIFY_PORT (with --keep: publish on 127.0.0.1:<port>),
#           VERIFY_URL_FILE (with --keep: where the throwaway database's address is written, mode 600).
# `--keep` leaves the restored container running for the upgrade rehearsal and prints its name.
. "$(dirname "$0")/lib.sh"
need docker

file="${1:-}"; manifest="${2:-}"; keep=0
[ "${3:-}" = "--keep" ] && keep=1
[ -n "$file" ] && [ -n "$manifest" ] || die "usage: verify-restore.sh <file.dump.gpg> <file.manifest> [--keep]"
[ $keep -eq 0 ] || [ -n "${VERIFY_URL_FILE:-}" ] || die "--keep needs VERIFY_URL_FILE"
[ -r "$file" ] || die "the backup file cannot be read"
[ -r "$manifest" ] || die "the manifest cannot be read"
: "${BACKUP_PRIVATE_KEY:?set BACKUP_PRIVATE_KEY}"
[ -r "$BACKUP_PRIVATE_KEY" ] || die "the private key file cannot be read"
image="${VERIFY_IMAGE:-postgres:16}"

id=$(sed -n 's/^id|//p' "$manifest")
want=$(sed -n 's/^sha256|//p' "$manifest")
mode=$(sed -n 's/^fingerprint-mode|//p' "$manifest")
[ -n "$id" ] && [ -n "$want" ] && [ -n "$mode" ] || die "the manifest is incomplete"
have=$(sha256_of "$file")
[ "$have" = "$want" ] || die "the file is not the one the manifest describes (SHA-256 differs)"

name="smilesim-verify-$(date -u +%H%M%S)-$$"
work=$(mktemp -d)
done_ok=0
cleanup() {
  rm -rf "$work"
  if [ $keep -eq 0 ] || [ $done_ok -eq 0 ]; then docker rm -f "$name" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

network="--network none"
[ $keep -eq 1 ] && network="-p 127.0.0.1:${VERIFY_PORT:-55439}:5432"
# A password that exists only for this throwaway container.
pass=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
# shellcheck disable=SC2086
docker run -d --name "$name" $network --tmpfs /run/key:mode=0700,uid=999 -e POSTGRES_USER=verify -e POSTGRES_DB=verify -e POSTGRES_PASSWORD="$pass" "$image" >/dev/null \
  || die "the verification database could not be started"
ready=0
for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -q -U verify -d verify 2>/dev/null && docker exec "$name" psql -X -qAt -U verify -d verify -c 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ $ready -eq 1 ] || die "the verification database did not come up"

# The private key goes to memory inside the container (a tmpfs), is imported there, and goes with the container.
docker exec -i -u postgres "$name" sh -c 'cat > /run/key/private.asc && chmod 600 /run/key/private.asc' < "$BACKUP_PRIVATE_KEY"
if [ -n "${BACKUP_KEY_PASSPHRASE_FILE:-}" ]; then
  docker exec -i -u postgres "$name" sh -c 'cat > /run/key/passphrase && chmod 600 /run/key/passphrase' < "$BACKUP_KEY_PASSPHRASE_FILE"
fi
docker exec -u postgres "$name" sh -c '
  export GNUPGHOME=/run/key/gnupg; mkdir -m 700 "$GNUPGHOME"
  pp=""; [ -e /run/key/passphrase ] && pp="--pinentry-mode loopback --passphrase-file /run/key/passphrase"
  gpg --batch --quiet --no-tty $pp --import /run/key/private.asc 2>/dev/null' \
  || die "the private key could not be imported"

# Decrypt and restore in one pipe, inside the container. --exit-on-error: a partial restore is a failed one.
docker exec -i -u postgres "$name" bash -c '
  set -eu; set -o pipefail
  export GNUPGHOME=/run/key/gnupg
  pp=""; [ -e /run/key/passphrase ] && pp="--pinentry-mode loopback --passphrase-file /run/key/passphrase"
  gpg --batch --quiet --no-tty $pp --decrypt 2>/run/key/gpg.err \
    | pg_restore --no-owner --no-privileges --exit-on-error -U verify -d verify 2>/run/key/restore.err' < "$file" \
  || die "the backup could not be decrypted and restored (wrong key, a damaged file, or a restore error)"

docker exec -i -u postgres "$name" sh -c 'psql -X -q -v ON_ERROR_STOP=1 -v mode="'"$mode"'" -At -F "|" -U verify -d verify -f - ' > "$work/restored.raw" <<SQL || die "the restored database could not be read"
begin isolation level repeatable read read only;
select \$\$server|\$\$ || current_setting(\$\$server_version\$\$);
$(cat "$FINGERPRINT_SQL_FILE")
commit;
SQL
LC_ALL=C sort "$work/restored.raw" > "$work/restored"
sed -n '/^--- fingerprint$/,$p' "$manifest" | sed 1d | grep -v '^uploaded|' > "$work/recorded"
[ -s "$work/recorded" ] || die "the manifest holds no fingerprint"

# The server's patch version may differ between the two hosts; everything else must be identical.
grep -v '^server|' "$work/recorded" > "$work/a"; grep -v '^server|' "$work/restored" > "$work/b"
if ! diff "$work/a" "$work/b" > "$work/diff"; then
  # Names of what differs, never content: the lines are kinds, names, counts and checksums.
  say "the restored database differs from what was backed up:"
  sed -n 's/^[<>] \([a-z]*|[^|]*\)|.*/  \1/p' "$work/diff" | LC_ALL=C sort -u | head -20 >&2
  die "verification of $id failed"
fi

# The database must also be usable, not only equal: every constraint that was valid is valid, and it accepts a write.
docker exec -u postgres "$name" psql -X -qAt -v ON_ERROR_STOP=1 -U verify -d verify -c 'create temp table _verify_write (x int); insert into _verify_write values (1);' >/dev/null \
  || die "the restored database does not accept writes"

done_ok=1
say "restored and compared: $(grep -c '^table|' "$work/b") tables, $(grep -c '^migration|' "$work/b") migrations, $(grep -c '^constraint|' "$work/b") constraints, $(grep -c '^index|' "$work/b") indexes"
[ $keep -eq 1 ] && say "kept for the rehearsal: container $name on 127.0.0.1:${VERIFY_PORT:-55439} (database verify, user verify); remove it with: docker rm -f $name"
echo "VERIFIED $id $have"
if [ $keep -eq 1 ]; then
  # The throwaway database's address goes to a file only its owner reads, never to the screen or a log.
  : "${VERIFY_URL_FILE:?--keep needs VERIFY_URL_FILE}"
  ( umask 077; printf 'postgresql://verify:%s@127.0.0.1:%s/verify\n' "$pass" "${VERIFY_PORT:-55439}" > "$VERIFY_URL_FILE" )
  echo "CONTAINER $name"
fi
exit 0
