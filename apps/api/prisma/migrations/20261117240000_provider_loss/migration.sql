-- An operation the provider was paid for and the point of sale was not charged for (ADR 0025, the owner's answer 4
-- and "an activation priced zero"; spec 2026-11-17-scale-speed-cleanup, "Paid at the provider, not charged to the
-- point of sale (DB.5 P.7)"). The operation's entry names why, so the office finds where it went wrong:
--   given_back  — the provider succeeded and the money was given back to the point of sale (release-after-success);
--   priced_zero — an activation or renewal sold to the point of sale at 0.
-- Written in the entry's own INSERT and never updated (the trial-data backfill aside). Null on every other row.
--
-- Adding a nullable column without a default rewrites nothing. Every stored row has it null, so the CHECK holds for
-- them: it is added NOT VALID (no scan under the ACCESS EXCLUSIVE lock) and validated at once (a scan under a lock
-- that lets reads and writes go on).

ALTER TABLE "WalletEntry" ADD COLUMN "providerLoss" TEXT;

-- One of the two reasons, and only on an operation that moved no money and names its provider.
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_provider_loss"
  CHECK ("providerLoss" IS NULL OR ("providerLoss" IN ('given_back', 'priced_zero') AND "amount" = 0 AND "providerId" IS NOT NULL AND "providerCost" IS NOT NULL)) NOT VALID;
ALTER TABLE "WalletEntry" VALIDATE CONSTRAINT "WalletEntry_provider_loss";

-- The marked operations of a provider, newest first: the provider summary's count and the screens' filter. Partial,
-- so Prisma cannot state it (named in `schema.prisma`, checked by `scripts/backup/rehearse-upgrade.sh`). A plain
-- CREATE INDEX (the spec's rule for a small table); the rows it holds are few.
CREATE INDEX "WalletEntry_provider_loss" ON "WalletEntry" ("providerId", "createdAt" DESC, "id" DESC) WHERE "providerLoss" IS NOT NULL;
