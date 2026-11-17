#!/usr/bin/env bash
# Rehearses the upgrade on a RESTORED COPY (docs/operations/backup-and-restore.md), never on production.
#
#   VERIFY_URL_FILE=<file written by `verify-restore.sh --keep`> scripts/backup/rehearse-upgrade.sh <file.manifest>
#
# On the throwaway database that verify-restore.sh left running, with the code checked out here:
#   1. `prisma migrate deploy`: every migration of this checkout must end applied, none failed.
#   2. Data checks after the migrations: no table lost or gained a row; every session has its token hash and an
#      old cookie still resolves; no notice keeps an old key; every package code a line names exists.
#   3. The API of this checkout is started against the copy in production mode, with a key made for this run, a
#      throwaway Redis, and no provider setting: it reaches nothing outside this machine (see the doc for what
#      that rests on). Smoke requests go through HTTP as a browser's would.
#   4. `seal-secrets --dry-run` counts the eSIM codes still stored clear; nothing is sealed.
#
# It prints `REHEARSED <backup id>` only when every step passed. Any failure stops it with one line.
# It needs: the API built (`npm run build --workspace api`), docker, node. Settings: REHEARSAL_PORT (default 3991),
# REHEARSAL_LOGIN / REHEARSAL_PASSWORD_FILE (an account of the copy to sign in as; without them the signed-in
# checks are skipped and said so), REHEARSAL_OTHER_LINE (optional: a line id that account must NOT see).
. "$(dirname "$0")/lib.sh"
need docker node npx

manifest="${1:-}"
[ -r "$manifest" ] || die "usage: rehearse-upgrade.sh <file.manifest>"
: "${VERIFY_URL_FILE:?set VERIFY_URL_FILE}"
[ -r "$VERIFY_URL_FILE" ] || die "the address file of the restored copy cannot be read"
id=$(sed -n 's/^id|//p' "$manifest")
root="$(cd "$(dirname "$0")/../.." && pwd)"
api="$root/apps/api"
[ -f "$api/dist/main.js" ] && [ -f "$api/dist/cli/seal-secrets.js" ] || die "the API is not built: npm run build --workspace api"
port="${REHEARSAL_PORT:-3991}"
url=$(cat "$VERIFY_URL_FILE")
case "$url" in postgresql://verify:*@127.0.0.1:*/verify) ;; *) die "the address is not a throwaway copy made by verify-restore.sh; refusing to run migrations on it" ;; esac

work=$(mktemp -d)
redis="smilesim-rehearsal-redis-$$"
api_pid=""
cleanup() {
  [ -n "$api_pid" ] && kill "$api_pid" 2>/dev/null || true
  docker rm -f "$redis" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

sql() { ( cd "$api" && DATABASE_URL="$url" node -e '
  const { Client } = require("pg");
  (async () => { const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    const r = await c.query(process.argv[1]); await c.end();
    console.log(r.rows.map((row) => Object.values(row).join("|")).join("\n")); })().catch((e) => { console.error("query failed: " + (e.code || "error")); process.exit(1); });' "$1" ); }

# 1. Migrations.
before=$(sql 'select count(*) from _prisma_migrations where finished_at is not null') || die "the copy cannot be read"
recorded=$(sed -n 's/^migrations|//p' "$manifest")
[ "$before" = "$recorded" ] || die "this copy is not as the backup left it ($before migrations applied, the backup had $recorded): restore a fresh copy with verify-restore.sh --keep"
( cd "$api" && DATABASE_URL="$url" npx prisma migrate deploy > "$work/migrate.log" 2>&1 ) || die "prisma migrate deploy failed on the copy (see the migration named last in its log; the copy is left as it is)"
expected=$(find "$api/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
applied=$(sql 'select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null')
failed=$(sql 'select count(*) from _prisma_migrations where finished_at is null')
[ "$applied" = "$expected" ] && [ "$failed" = "0" ] || die "migrations: $applied applied of $expected, $failed unfinished"
say "migrations: $before applied before, $applied after, none unfinished"

# 2. Data after the migrations. Row counts of every table that existed before must be what the backup recorded.
sed -n 's/^table|\([^|]*\)|\([0-9]*\).*/\1|\2/p' "$manifest" | grep -v '^_prisma_migrations|' | LC_ALL=C sort > "$work/before"
: > "$work/after"
while IFS='|' read -r table _count; do
  echo "$table|$(sql "select count(*) from \"$table\"")" >> "$work/after"
done < "$work/before"
diff "$work/before" "$work/after" > "$work/counts.diff" || { sed -n 's/^[<>] \([^|]*\)|.*/  \1/p' "$work/counts.diff" | LC_ALL=C sort -u >&2; die "a table has a different number of rows after the migrations"; }
check() { got=$(sql "$2"); [ "$got" = "$3" ] || die "after the migrations: $1 (expected $3, found $got)"; }
check "sessions without a token hash" 'select count(*) from "Session" where "tokenHash" is null' 0
check "sessions whose hash is not the hash of their old cookie" "select count(*) from \"Session\" where \"tokenHash\" <> encode(sha256(convert_to(id, 'UTF8')), 'hex')" 0
check "notices that keep an old key" "select count(*) from \"Notice\" where payload ? 'toLogin' or payload ? 'fromLogin'" 0
check "lines whose package code is not a package" "select count(*) from \"Line\" l where not exists (select 1 from \"Package\" p where p.code = l.terms ->> 'packageCode')" 0
check "lines whose package code is not their own package's" "select count(*) from \"Line\" l join \"Package\" p on p.id = l.\"packageId\" where p.code <> l.terms ->> 'packageCode'" 0
check "packages without a provider product code" 'select count(*) from "Package" where "providerProductCode" is null' 0
check "duplicate package codes" 'select count(*) from (select code from "Package" group by code having count(*) > 1) x' 0
check "reservation indexes" "select count(*) from pg_indexes where indexname in ('Task_open_activation_iccid', 'Task_open_activation_msisdn')" 2
# Partial and expression indexes the schema cannot state, so `prisma migrate diff` does not see them either.
check "raw-SQL indexes" "select count(*) from pg_indexes where indexname in ('WalletEntry_sale_or_refund_createdAt_id', 'WalletEntry_provider_createdAt_id', 'ProviderOperation_unsettled_id', 'Notice_kind_taskId', 'RequestLog_operatorId_at_idx', 'RequestLog_ip_pattern_at_idx', 'WalletEntry_chainMainAgent_createdAt', 'WalletEntry_chainAgent_createdAt', 'WalletEntry_chainPos_createdAt', 'WalletEntry_provider_loss')" 10
# The provider ledger's CHECK (ADR 0025, migrations 20261117210000_provider_ledger_stored and
# 20261117220100_provider_ledger_validate): validated only when the copy's operation entries all carry a provider and
# a cost, that is when the backfill ran on the server the backup came from, so only its presence is checked here;
# the operator checks `convalidated` on the deployment itself (handover, technical-operations-ar.md §13).
check "the provider ledger's CHECK" "select count(*) from pg_constraint where conname = 'WalletEntry_operation_priced'" 1
# The stored margins' CHECK (ADR 0026, migration 20261117230000_stored_margins): validated by the backfill or the
# validate migration only when the copy's entries with a ladder all carry their margins, so only its presence here.
check "the stored margins' CHECK" "select count(*) from pg_constraint where conname = 'WalletEntry_sale_margins'" 1
# The provider loss mark's CHECK (migration 20261117240000_provider_loss): validated by the migration itself.
check "the provider loss CHECK, validated" "select count(*) from pg_constraint where conname = 'WalletEntry_provider_loss' and convalidated" 1
# Storage settings the schema cannot state either (migrations 20261117180000_request_log_indexes and
# 20261117200000_table_settings). The latter's three CHECK validations depend on the copy's old rows, so not checked.
check "table storage settings" "select count(*) from pg_class where relkind = 'r' and ((relname = 'RequestLog' and 'autovacuum_vacuum_scale_factor=0.02' = any(reloptions)) or (relname = 'ActivityEvent' and 'autovacuum_vacuum_scale_factor=0.02' = any(reloptions)) or (relname = 'Wallet' and 'fillfactor=70' = any(reloptions)) or (relname = 'Session' and 'fillfactor=80' = any(reloptions)) or (relname in ('WalletEntry', 'Line') and 'autovacuum_analyze_scale_factor=0.02' = any(reloptions)))" 6
# The search's trigram indexes need the extension (migration 20261117170000_search_trigram).
check "search extension and trigram indexes" "select (select count(*) from pg_extension where extname = 'pg_trgm') + (select count(*) from pg_indexes where indexname like '%_msisdn_trgm_idx' or indexname = 'Line_iccid_trgm_idx')" 5
say "data: $(wc -l < "$work/before" | tr -d ' ') tables kept their rows; sessions, notices, package codes, reservation, raw-SQL and search indexes, the provider ledger's, the stored margins' and the provider loss CHECKs, the tables' storage settings as expected"

# 3. The new API on the copy. A key and a Redis that exist for this run only.
docker run -d --name "$redis" -p "127.0.0.1:$((port + 1)):6379" redis:8 >/dev/null || die "the throwaway Redis could not be started"
key=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')
(
  cd "$api"
  env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production PORT="$port" DATABASE_URL="$url" REDIS_URL="redis://127.0.0.1:$((port + 1))" \
    COOKIE_SECURE=true WEB_ORIGIN=https://rehearsal.invalid TRUST_PROXY=1 SECRETS_KEY="$key" \
    node dist/main.js > "$work/api.log" 2>&1 &
  echo $! > "$work/api.pid"
)
api_pid=$(cat "$work/api.pid")
up=0
for _ in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:$port/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then up=1; break; fi
  kill -0 "$api_pid" 2>/dev/null || break
  sleep 1
done
[ $up -eq 1 ] || { grep -E "Config|unsafe|Error" "$work/api.log" | head -5 | cut -c1-200 >&2; die "the new API did not start on the copy"; }
say "the new API started on the copy in production mode"

old_cookie=$(sql 'select id from "Session" where "revokedAt" is null and "expiresAt" > now() and scope = '"'"'full'"'"' order by id limit 1')
# Production's Redis holds that session's live key under the name the deployed version wrote: `session:<row id>`.
[ -z "$old_cookie" ] || docker exec "$redis" redis-cli set "session:$old_cookie" rehearsal EX 3600 >/dev/null
REHEARSAL_BASE="http://127.0.0.1:$port" REHEARSAL_OLD_COOKIE="$old_cookie" node "$(dirname "$0")/rehearsal-smoke.mjs" || die "a smoke request failed on the copy"
grep -Eq "ESIM_CODE_UNSEALABLE|Refusing to start" "$work/api.log" && die "the API logged a refused setting or an unsealable code"

# 4. The backfill's dry run: counts only.
(
  cd "$api"
  env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production DATABASE_URL="$url" REDIS_URL="redis://127.0.0.1:$((port + 1))" SECRETS_KEY="$key" \
    node dist/cli/seal-secrets.js --dry-run > "$work/seal.log" 2>&1
) || die "seal-secrets --dry-run failed on the copy"
clear_lines=$(sql "select count(*) from \"Line\" where \"esimQr\" is not null and \"esimQr\" not like 'v1:%'")
clear_tasks=$(sql "select count(*) from \"Task\" where \"esimQr\" is not null and \"esimQr\" not like 'v1:%'")
grep -q "Line.esimQr: $clear_lines stored clear" "$work/seal.log" || die "the dry run's count of line codes is not what the copy holds"
grep -q "Task.esimQr: $clear_tasks stored clear" "$work/seal.log" || die "the dry run's count of task codes is not what the copy holds"
say "seal-secrets --dry-run: $clear_lines line code(s) and $clear_tasks task code(s) stored clear; nothing was sealed"

echo "REHEARSED $id"
