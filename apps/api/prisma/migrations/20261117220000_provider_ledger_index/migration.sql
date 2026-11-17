-- The provider ledger's index (ADR 0025, slice P.3; plan 2026-11-17-database-scale, DB.5). Every entry that carries
-- a provider (the operation kinds, `operationColumns` in wallets/provider-cost.ts) by provider, newest first, with
-- its cost in the index itself: a provider's purchases are `SUM("providerCost") ... GROUP BY "providerId"` read from
-- the index alone, and its ledger page is a keyset walk of it (`providerId`, `createdAt` DESC, `id` DESC).
--
-- Partial, so Prisma cannot state it: `schema.prisma` names it beside `WalletEntry`, `prisma migrate diff` does not
-- see it, and `scripts/backup/rehearse-upgrade.sh` checks it exists.
--
-- A plain CREATE INDEX inside the migration's transaction (spec 2026-11-17-scale-speed-cleanup, "Rules that hold for
-- every slice": the production table is small today). It holds a SHARE lock on "WalletEntry" while it builds: reads
-- go on, writes wait for the build, which on today's table is a moment; the release is deployed with writes stopped.

CREATE INDEX "WalletEntry_provider_createdAt_id" ON "WalletEntry" ("providerId", "createdAt" DESC, "id" DESC)
  INCLUDE ("providerCost") WHERE "providerId" IS NOT NULL;
