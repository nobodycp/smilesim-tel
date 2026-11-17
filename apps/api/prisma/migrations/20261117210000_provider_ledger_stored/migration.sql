-- The provider ledger stored (ADR 0025, slice P.1; plan 2026-11-17-database-scale, DB.5). An operation's wallet entry
-- carries the provider of its package and its provider cost, both written in the entry's own INSERT and never
-- updated. No foreign key on "providerId": the key's FOR KEY SHARE on the provider's row would wait on the send
-- gate's FOR UPDATE under the wallet lock (ADR 0025, rule 2).
--
-- Adding a nullable column without a default rewrites nothing. The CHECK is added NOT VALID: every row written from
-- now on is checked, the rows stored before are not read. The backfill command (`provider-ledger-backfill`) fills
-- those; the VALIDATE comes in its own migration, in the release after the backfill ran (slice P.3).
--
-- The kinds are `PROVIDER_OPERATION_KINDS` (wallets/provider-cost.ts); provider-priced-entries.db.spec.ts compares
-- the two lists.

ALTER TABLE "WalletEntry" ADD COLUMN "providerId" TEXT;

ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_operation_priced"
  CHECK ("kind" NOT IN ('activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch',
                        'rename', 'sim', 'esim', 'refresh', 'transfer')
         OR ("providerId" IS NOT NULL AND "providerCost" IS NOT NULL)) NOT VALID;
