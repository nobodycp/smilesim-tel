-- A given-back operation charged later (spec 2026-11-17-scale-speed-cleanup, "A given-back operation charged later
-- (DB.5 P.9)"; ADR 0027). The branch charges the point of sale for an activation the provider carried out and whose
-- money was given back, from the marked operation itself: a sale entry that names the operation's row, and the row's
-- mark turned `given_back` → `charged_later` (no money column of it touched).
--
-- Adding a nullable column without a default rewrites nothing. The CHECK is replaced by one that takes the third
-- value: dropped and added NOT VALID in one statement (no scan under the ACCESS EXCLUSIVE lock), then validated (a scan
-- under a lock that lets reads and writes go on). Every stored mark is one of the first two, so it holds.

ALTER TABLE "WalletEntry" ADD COLUMN "chargesEntryId" TEXT;

ALTER TABLE "WalletEntry"
  DROP CONSTRAINT "WalletEntry_provider_loss",
  ADD CONSTRAINT "WalletEntry_provider_loss"
    CHECK ("providerLoss" IS NULL OR ("providerLoss" IN ('given_back', 'priced_zero', 'charged_later') AND "amount" = 0 AND "providerId" IS NOT NULL AND "providerCost" IS NOT NULL)) NOT VALID;
ALTER TABLE "WalletEntry" VALIDATE CONSTRAINT "WalletEntry_provider_loss";

-- One charge per operation: the database refuses a second sale entry naming the same marked row. Partial (the rows
-- that name one are few), so Prisma cannot state it (named in `schema.prisma`, checked by
-- `scripts/backup/rehearse-upgrade.sh`). A plain CREATE UNIQUE INDEX (the spec's rule for a small table). No foreign
-- key, as the other ledger columns of the entry have none.
CREATE UNIQUE INDEX "WalletEntry_charges_entry" ON "WalletEntry" ("chargesEntryId") WHERE "chargesEntryId" IS NOT NULL;
