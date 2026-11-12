#!/usr/bin/env bash
# Builds the synthetic source database of the backup specs: the schema of an OLDER commit (its migrations applied
# one by one and recorded as Prisma records them) filled with made-up rows (seed-old-schema.sql).
#
#   make-synthetic-db.sh <postgres container> <database name> <commit> <password hash>
#
# It creates (and first drops) <database name> on that container. Never point it at anything real.
set -eu
container="$1"; db="$2"; commit="$3"; hash="$4"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
case "$db" in smilesim_bk_*) ;; *) echo "make-synthetic-db.sh: the database name must start with smilesim_bk_" >&2; exit 1 ;; esac
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
( cd "$root" && git archive "$commit" apps/api/prisma/migrations ) | tar -x -C "$work"
user=$(docker exec "$container" sh -c 'echo "$POSTGRES_USER"')
p() { docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -U "$user" "$@"; }
p -d postgres -c "drop database if exists $db" -c "create database $db" < /dev/null 2>/dev/null
p -d "$db" -c 'create table "_prisma_migrations" (id varchar(36) primary key, checksum varchar(64) not null, finished_at timestamptz, migration_name varchar(255) not null, logs text, rolled_back_at timestamptz, started_at timestamptz not null default now(), applied_steps_count integer not null default 0)' < /dev/null
for dir in $(ls "$work/apps/api/prisma/migrations" | grep -v toml | LC_ALL=C sort); do
  file="$work/apps/api/prisma/migrations/$dir/migration.sql"
  p -d "$db" < "$file" >/dev/null 2>&1 || { echo "make-synthetic-db.sh: migration $dir failed" >&2; exit 1; }
  sum=$( (sha256sum "$file" 2>/dev/null || shasum -a 256 "$file") | cut -d' ' -f1)
  p -d "$db" -c "insert into _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) values (gen_random_uuid()::text, '$sum', now(), '$dir', 1)" < /dev/null
done
p -d "$db" -v hash="$hash" < "$here/seed-old-schema.sql" >/dev/null
echo "$db: $(p -d "$db" -Atc 'select count(*) from _prisma_migrations' < /dev/null) migrations, $(p -d "$db" -Atc 'select count(*) from "Line"' < /dev/null) lines"
