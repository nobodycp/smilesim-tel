#!/usr/bin/env bash
# Fetches a backup and its manifest from Cloudflare R2 for a restore (docs/operations/backup-and-restore.md).
# Run on the machine that restores, with a READ-ONLY R2 credential; never needed on the production host.
#
#   r2-fetch.sh list [daily|monthly]        the backups held, newest last
#   r2-fetch.sh latest <directory>          the newest daily backup
#   r2-fetch.sh <id> <directory> [monthly]  one backup by its id (smilesim-YYYYMMDDTHHMMSSZ, or smilesim-YYYYMM)
#
# The file is checked against its manifest's SHA-256 before the script succeeds. Then:
#   verify-restore.sh <directory>/<id>.dump.gpg <directory>/<id>.manifest
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/r2-lib.sh"
r2_settings

list() { # the ids under a folder, sorted
  local folder="$1" out status
  out=$(mktemp)
  status=$(R2_BODY_TO="$out" r2_curl GET "" --get --data-urlencode "list-type=2" --data-urlencode "prefix=$R2_PREFIX/$folder/" --data-urlencode "max-keys=1000") || { rm -f "$out"; die "the storage could not be reached"; }
  [ "$status" = "200" ] || { rm -f "$out"; die "the storage answered HTTP $status to the listing"; }
  tr '<' '\n' < "$out" | sed -n 's/^Key>//p' | sed -n "s#^$R2_PREFIX/$folder/\(.*\)\.dump\.gpg\$#\1#p" | LC_ALL=C sort
  rm -f "$out"
}

get() { # key, destination
  local status
  status=$(R2_BODY_TO="$2.partial" r2_curl GET "$1") || { rm -f "$2.partial"; die "the download of $1 did not complete"; }
  [ "$status" = "200" ] || { rm -f "$2.partial"; die "the storage answered HTTP $status for $1"; }
  mv "$2.partial" "$2"
}

case "${1:-}" in
  list) list "${2:-daily}"; exit 0 ;;
  "") die "usage: r2-fetch.sh list [daily|monthly] | latest <directory> | <id> <directory> [monthly]" ;;
esac
id="$1"; dir="${2:-}"; folder="${3:-daily}"
[ -n "$dir" ] || die "name the directory to fetch into"
if [ "$id" = "latest" ]; then
  id=$(list daily | tail -1)
  [ -n "$id" ] || die "the storage holds no daily backup"
fi
mkdir -p "$dir" && chmod 700 "$dir"
get "$R2_PREFIX/$folder/$id.manifest" "$dir/$id.manifest"
get "$R2_PREFIX/$folder/$id.dump.gpg" "$dir/$id.dump.gpg"
want=$(sed -n 's/^sha256|//p' "$dir/$id.manifest" | head -1)
[ -n "$want" ] && [ "$(sha256_of "$dir/$id.dump.gpg")" = "$want" ] || die "the downloaded file is not the one its manifest describes"
chmod 600 "$dir/$id.dump.gpg" "$dir/$id.manifest"
say "fetched $id ($(wc -c < "$dir/$id.dump.gpg" | tr -d ' ') bytes), SHA-256 as recorded"
echo "$dir/$id"
