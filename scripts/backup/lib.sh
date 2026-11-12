# Shared by the backup scripts. Sourced, not run.
#
# Nothing here prints a connection string, a password, a key or a row. A failure is one line on stderr, prefixed
# with the script's name, and a non-zero exit.

set -eu
set -o pipefail

die() { echo "$(basename "$0"): FAILED: $*" >&2; exit 1; }
say() { echo "$(basename "$0"): $*" >&2; }

need() { for tool in "$@"; do command -v "$tool" >/dev/null 2>&1 || die "missing tool: $tool"; done; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# The fingerprint queries (fingerprint.sql): what a database holds, without any of it.
FINGERPRINT_SQL_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fingerprint.sql"
