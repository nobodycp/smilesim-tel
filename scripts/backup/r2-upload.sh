#!/usr/bin/env bash
# Stores one encrypted backup and its manifest in Cloudflare R2 (docs/operations/backup-and-restore.md).
# Used as backup.sh's upload command:  BACKUP_UPLOAD_CMD=/path/to/r2-upload.sh
#
#   r2-upload.sh <file.dump.gpg> <file.manifest>
#
# - Only an encrypted backup is sent: the file must be the one its manifest describes (SHA-256) and must not be
#   a clear PostgreSQL dump.
# - A name is written once. The upload carries `If-None-Match: *`, so R2 refuses to replace an object that is
#   already there; the bucket's lock rule refuses it too, and refuses deletion, for the retention period.
# - R2 checks the body against the SHA-256 and the MD5 sent with it, so a cut or altered upload is refused by
#   the storage itself. Afterwards the stored size is read back and must be the file's.
# - A dropped connection or a server error is tried again (R2_TRIES, default 5, waiting longer each time).
#   Anything else stops at once.
# - The first backup of each month is also kept under `monthly/`, where it is held longer.
# - Exit 0 only when both the file and its manifest are stored and read back with the right size. The caller
#   (backup.sh) keeps the local copy until then.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/r2-lib.sh"

file="${1:-}"; manifest="${2:-}"
[ -r "$file" ] && [ -r "$manifest" ] || die "usage: r2-upload.sh <file.dump.gpg> <file.manifest>"
r2_settings
need openssl
tries="${R2_TRIES:-5}"

case "$file" in *.dump.gpg) ;; *) die "not an encrypted backup (the name does not end in .dump.gpg)" ;; esac
[ "$(head -c 5 "$file")" != "PGDMP" ] || die "this is a clear PostgreSQL dump; only encrypted backups are uploaded"
want=$(sed -n 's/^sha256|//p' "$manifest" | head -1)
[ -n "$want" ] && [ "$(sha256_of "$file")" = "$want" ] || die "the file is not the one its manifest describes"
id=$(sed -n 's/^id|//p' "$manifest" | head -1)
[ -n "$id" ] || die "the manifest has no id"

# put <local file> <key>: stored once, verified, retried on network and server errors.
put() {
  local path="$1" key="$2" size sum md5 status attempt=1 wait=3 held
  size=$(wc -c < "$path" | tr -d ' ')
  sum=$(sha256_of "$path")
  md5=$(openssl dgst -md5 -binary "$path" | openssl base64)
  while :; do
    status=$(r2_curl PUT "$key" --upload-file "$path" -H "If-None-Match: *" -H "x-amz-content-sha256: $sum" -H "Content-MD5: $md5" -H "Content-Type: application/octet-stream") || status="network"
    case "$status" in
      200|201) break ;;
      412)
        # Already there. The same bytes (a run repeated after a lost answer) is success; anything else is refused.
        held=$(r2_size "$key") || die "the storage could not be read after it refused to replace $key"
        [ "$held" = "$size" ] || die "an object named $key already exists with another size; it was NOT replaced"
        say "already stored: $key"
        return 0 ;;
      409) die "the storage refused $key: an object of that name is locked" ;;
      401|403) die "the storage refused the credentials or the bucket (HTTP $status)" ;;
      network|5??|429)
        [ "$attempt" -lt "$tries" ] || die "the upload of $key did not complete after $tries tries (last: $status)"
        say "upload of $key: $status, trying again in ${wait}s ($attempt/$tries)"
        sleep "$wait"; attempt=$((attempt + 1)); wait=$((wait * 2)) ;;
      *) die "the storage answered HTTP $status for $key" ;;
    esac
  done
  held=$(r2_size "$key") || die "the stored size of $key could not be read back"
  [ "$held" = "$size" ] || die "the storage holds ${held:-nothing} bytes for $key, the file has $size"
}

put "$file" "$R2_PREFIX/daily/$id.dump.gpg"
put "$manifest" "$R2_PREFIX/daily/$id.manifest"
# The month's first backup, kept longer. A later one of the same month finds the name taken and leaves it.
month=$(printf '%s' "$id" | sed -n 's/^smilesim-\([0-9]\{6\}\).*/\1/p')
if [ -n "$month" ]; then
  status=$(r2_curl HEAD "$R2_PREFIX/monthly/smilesim-$month.dump.gpg" --head) || status="network"
  if [ "$status" = "404" ]; then
    put "$file" "$R2_PREFIX/monthly/smilesim-$month.dump.gpg"
    put "$manifest" "$R2_PREFIX/monthly/smilesim-$month.manifest"
  fi
fi
say "stored in R2: $R2_PREFIX/daily/$id ($(wc -c < "$file" | tr -d ' ') bytes)"
