-- The daily purges' indexes (plan 2026-11-17-database-scale, DB.13; audit 2026-11-17, section 9, D.13). Indexes
-- only: no row changes. A plain CREATE INDEX: both tables are small enough today, and the retention keeps them so.

-- Notices are read by account (userId first); the purge deletes by age across every account.
CREATE INDEX "Notice_createdAt_idx" ON "Notice"("createdAt");

-- Line counts are keyed (userId, day); the purge deletes the days older than 400 across every account.
CREATE INDEX "LineCountSnapshot_day_idx" ON "LineCountSnapshot"("day");
