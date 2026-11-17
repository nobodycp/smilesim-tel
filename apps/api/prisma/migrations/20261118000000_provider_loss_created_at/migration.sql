-- The branch's losses over a period (spec 2026-11-17-scale-speed-cleanup, "Branch losses in the profit figures
-- (DB.5 P.8)"): every profit figure of the branch is net of the operations marked as its loss (P.7) in the period.
-- The sales read keeps its own predicate and its partial index (`WalletEntry_sale_or_refund_createdAt_id`); the
-- losses are a second read, `WHERE "providerLoss" IS NOT NULL` and the period, which this index serves whatever the
-- table's size. `WalletEntry_provider_loss` leads with the provider (the provider's books and the screens' filter);
-- this one with the time alone (the home, the profit report and the finance summary of every provider at once).
--
-- Partial, so Prisma cannot state it (named in `schema.prisma`, checked by `scripts/backup/rehearse-upgrade.sh`). A
-- plain CREATE INDEX (the spec's rule for a small table); the rows it holds are few by nature.

CREATE INDEX "WalletEntry_loss_createdAt" ON "WalletEntry" ("createdAt" DESC) WHERE "providerLoss" IS NOT NULL;
