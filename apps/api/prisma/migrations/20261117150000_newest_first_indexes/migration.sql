-- Indexes for the newest-first order (plan 2026-11-17-database-scale, DB.1; audit 2026-11-17, D.1). Every
-- cursor-paged list reads `ORDER BY "createdAt" DESC, "id" DESC` (NEWEST_FIRST, platform/paging.ts): these let the
-- database walk the index in that order and stop at the page, instead of sorting every matching row. Indexes only:
-- no row changes. A plain CREATE INDEX: the tables are small today (spec 2026-11-17-scale-speed-cleanup).

-- An account's entries newest first: replaces ("userId", "createdAt"), which served the same reads without the tie.
DROP INDEX "WalletEntry_userId_createdAt_idx";
CREATE INDEX "WalletEntry_userId_createdAt_id_idx" ON "WalletEntry"("userId", "createdAt" DESC, "id" DESC);

-- The branch's lists, which filter nothing by account: numbers, finance, the inbox.
CREATE INDEX "Line_createdAt_id_idx" ON "Line"("createdAt" DESC, "id" DESC);
CREATE INDEX "WalletEntry_createdAt_id_idx" ON "WalletEntry"("createdAt" DESC, "id" DESC);
CREATE INDEX "Task_createdAt_id_idx" ON "Task"("createdAt" DESC, "id" DESC);

-- The inbox of an account below the branch (`posId IN (…)`); it also serves the point of sale's foreign key.
CREATE INDEX "Task_posId_createdAt_id_idx" ON "Task"("posId", "createdAt" DESC, "id" DESC);

-- The sales and refunds, newest first: the overview (`periodEntries`, `totalsBetween`), the profit report and the
-- finance summary. The predicate is the one those callers send (SALE_KINDS with a negative amount, REFUND_KINDS with
-- a positive one; pricing/rules/profit-ladder.ts). Prisma cannot state a partial index, so the schema does not list
-- it and `prisma migrate diff` does not see it (like `Task_open_activation_iccid`). If SALE_KINDS or REFUND_KINDS
-- change, this index must be rebuilt with the new lists, or the planner stops using it.
CREATE INDEX "WalletEntry_sale_or_refund_createdAt_id" ON "WalletEntry"("createdAt" DESC, "id" DESC)
  WHERE ("kind" IN ('activate', 'charge', 'extend', 'reactivate') AND "amount" < 0)
     OR ("kind" = 'disconnect' AND "amount" > 0);
