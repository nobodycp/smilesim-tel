# Cloudflare R2 through its S3-compatible API, with curl's own SigV4 signing. Sourced by r2-upload.sh and
# r2-fetch.sh. Needs curl 7.75 or later.
#
# Settings (a file only its owner reads; see r2.env.example):
#   R2_ACCOUNT_ID          the Cloudflare account id (not a secret, but not published either)
#   R2_BUCKET              the bucket's name
#   R2_ACCESS_KEY_ID       the R2 API token's Access Key ID
#   R2_SECRET_ACCESS_KEY   its Secret Access Key
#   R2_PREFIX              folder inside the bucket (default: smilesim)
#   R2_ENDPOINT            only to override: a jurisdiction endpoint, or a local stand-in in the specs
#
# The two keys never appear on a command line (they are given to curl on its standard input), in a log, or in
# an error message.

r2_settings() {
  : "${R2_BUCKET:?set R2_BUCKET}"
  : "${R2_ACCESS_KEY_ID:?set R2_ACCESS_KEY_ID}"
  : "${R2_SECRET_ACCESS_KEY:?set R2_SECRET_ACCESS_KEY}"
  if [ -z "${R2_ENDPOINT:-}" ]; then
    : "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID}"
    R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  fi
  R2_PREFIX="${R2_PREFIX:-smilesim}"
  need curl
  curl --help all 2>/dev/null | grep -q -- '--aws-sigv4' || die "this curl cannot sign S3 requests (needs 7.75 or later)"
}

# r2_curl <method> <key> [curl options...]  -> prints the HTTP status; the body goes where the options say.
# Exit code is curl's: non-zero means the request did not complete (network), whatever the status.
r2_curl() {
  local method="$1" key="$2"; shift 2
  printf 'user = "%s:%s"\n' "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" | curl --silent --show-error --config - \
    --aws-sigv4 "aws:amz:auto:s3" --request "$method" --connect-timeout 20 --max-time "${R2_MAX_TIME:-900}" \
    --output "${R2_BODY_TO:-/dev/null}" --write-out '%{http_code}' "$@" "$R2_ENDPOINT/$R2_BUCKET/$key" 2>/dev/null
}

# The size R2 holds for a key, or nothing when it is not there.
r2_size() {
  local headers status
  headers=$(mktemp)
  status=$(R2_BODY_TO=/dev/null r2_curl HEAD "$1" --head --dump-header "$headers") || { rm -f "$headers"; return 1; }
  if [ "$status" = "200" ]; then tr -d '\r' < "$headers" | awk -F': ' 'tolower($1) == "content-length" { print $2 }' | tail -1; fi
  rm -f "$headers"
  [ "$status" = "200" ] || [ "$status" = "404" ]
}
