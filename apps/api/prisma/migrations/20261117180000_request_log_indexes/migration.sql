-- The request log's indexes (plan 2026-11-17-database-scale, DB.14; audit 2026-11-17, sections 3.4, 7 and 9, D.14).
-- Indexes and a storage setting only: no row changes. A plain CREATE INDEX: the table is small today and keeps 14
-- days (spec 2026-11-17-scale-speed-cleanup). Kept as they were: (at), (status, at), (route, at), (actorId, at).

-- The start of an address (`ip LIKE '10.0.%'`): a btree under the database's collation (en_US.utf8) cannot serve a
-- prefix, so (ip, at) was only ever scanned whole. `text_pattern_ops` can; no read compares an address with `<`.
-- `ip` is NOT NULL, so the predicate holds for every row, and every `LIKE` on `ip` implies it (the operator is
-- strict): it is there because Prisma cannot read a btree's operator class back, and would otherwise show this index
-- in `prisma migrate diff` for ever. As a partial index it is raw SQL like the others; the upgrade rehearsal checks it.
DROP INDEX "RequestLog_ip_at_idx";
CREATE INDEX "RequestLog_ip_pattern_at_idx" ON "RequestLog"("ip" text_pattern_ops, "at") WHERE "ip" IS NOT NULL;

-- The account filter is three branches: by login name, by id, and as the account that entered another. The page
-- (`request-log.repository.ts` `rows`) reads each branch on its own index; the count and the summary keep the `OR`,
-- which the database now answers by OR-ing the three indexes (a BitmapOr) instead of walking the window by time.
CREATE INDEX "RequestLog_actorLoginName_at_idx" ON "RequestLog"("actorLoginName", "at");
-- Entered sessions only: a few rows. Prisma cannot state a partial index, so the schema names it in a comment and
-- `prisma migrate diff` does not see it; the upgrade rehearsal checks it exists.
CREATE INDEX "RequestLog_operatorId_at_idx" ON "RequestLog"("operatorId", "at") WHERE "operatorId" IS NOT NULL;

-- The daily purge deletes a fourteenth of the table: vacuum it the same day, not after a fifth of the table changed
-- (the default 0.2). PostgreSQL 16 and 18 both take it; `pg_dump` keeps it. This table only (DB.15 does the rest).
ALTER TABLE "RequestLog" SET (autovacuum_vacuum_scale_factor = 0.02);
