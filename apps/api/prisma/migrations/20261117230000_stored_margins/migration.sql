-- Each sale's and refund's margins stored on its wallet entry (ADR 0026, slice M.1; plan 2026-11-17-database-scale,
-- DB.12). The entry keeps its chain by layer (the point of sale, the agent and the main agent; the branch is the
-- tree's root and is not stored) and what each layer earned on it, written by `WalletLedger.post` in the entry's own
-- INSERT from the ladder it already writes (`marginOf`), and never updated. No foreign keys: the ids inside the ladder
-- have none, and a key would take a lock on the account rows under the wallet lock.
--
-- Adding a nullable column without a default rewrites nothing. The CHECK is added NOT VALID: every row written from
-- now on is checked, the rows stored before are not read. The backfill command (`stored-margins-backfill`) fills
-- them and validates it; migration 20261117230200_stored_margins_validate validates it when no stored row breaks it.

ALTER TABLE "WalletEntry"
  ADD COLUMN "chainPosId" TEXT,
  ADD COLUMN "chainAgentId" TEXT,
  ADD COLUMN "chainMainAgentId" TEXT,
  ADD COLUMN "posMargin" INTEGER,
  ADD COLUMN "agentMargin" INTEGER,
  ADD COLUMN "mainAgentMargin" INTEGER,
  ADD COLUMN "branchMargin" INTEGER;

-- An entry that keeps a ladder keeps its point of sale and the branch's margin: the two every chain has.
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_sale_margins"
  CHECK ("ladder" IS NULL OR ("chainPosId" IS NOT NULL AND "branchMargin" IS NOT NULL)) NOT VALID;
