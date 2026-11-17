-- The stored margins' indexes (ADR 0026, slice M.3; plan 2026-11-17-database-scale, DB.12). Each layer below the
-- branch reads the sales and refunds of the chains it was in at the time (the owner's answer 1), by its own column,
-- over a period: these walk one account's entries newest first, with the figures the period's cards add up (its
-- margin, the amount, the kind) in the index itself, so the totals and the trend are read from the index alone. The
-- branch reads every sale and refund: the partial index `WalletEntry_sale_or_refund_createdAt_id` (migration
-- 20261117150000_newest_first_indexes) serves it.
--
-- Partial (only the entries that carry a chain, the sales and refunds), so Prisma cannot state them: `schema.prisma`
-- names them beside `WalletEntry`, `prisma migrate diff` does not see them, and `scripts/backup/rehearse-upgrade.sh`
-- checks they exist.
--
-- A plain CREATE INDEX inside the migration's transaction (spec 2026-11-17-scale-speed-cleanup, "Rules that hold for
-- every slice": the production table is small today). Each holds a SHARE lock on "WalletEntry" while it builds: reads
-- go on, writes wait for the build, which on today's table is a moment; the release is deployed with writes stopped.

CREATE INDEX "WalletEntry_chainMainAgent_createdAt" ON "WalletEntry" ("chainMainAgentId", "createdAt" DESC, "id" DESC)
  INCLUDE ("mainAgentMargin", "amount", "kind") WHERE "chainMainAgentId" IS NOT NULL;
CREATE INDEX "WalletEntry_chainAgent_createdAt" ON "WalletEntry" ("chainAgentId", "createdAt" DESC, "id" DESC)
  INCLUDE ("agentMargin", "amount", "kind") WHERE "chainAgentId" IS NOT NULL;
CREATE INDEX "WalletEntry_chainPos_createdAt" ON "WalletEntry" ("chainPosId", "createdAt" DESC, "id" DESC)
  INCLUDE ("posMargin", "amount", "kind") WHERE "chainPosId" IS NOT NULL;
