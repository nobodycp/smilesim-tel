-- The stored margins' CHECK validated (ADR 0026, slice M.3). `WalletEntry_sale_margins` was added NOT VALID by
-- 20261117230000_stored_margins: every row written since is checked, the rows stored before were not. The backfill
-- command (`stored-margins-backfill`, run once after the deploy) gives those rows their margins and validates the
-- CHECK itself; the reads are sums of the margins, so an entry with a ladder and without them would count nothing.
--
-- Validated here only when no stored row breaks it, so this migration never fails a deployment whose backfill has not
-- run: the CHECK is then named in a WARNING and stays NOT VALID (new writes are still checked). Validating reads the
-- table once under SHARE UPDATE EXCLUSIVE: reads and writes go on. `pg_constraint.convalidated` tells which.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "WalletEntry" WHERE NOT ("ladder" IS NULL OR ("chainPosId" IS NOT NULL AND "branchMargin" IS NOT NULL))
  ) THEN
    ALTER TABLE "WalletEntry" VALIDATE CONSTRAINT "WalletEntry_sale_margins";
  ELSE
    RAISE WARNING 'WalletEntry_sale_margins left NOT VALID: entries with a ladder and without their margins are stored (run stored-margins-backfill)';
  END IF;
END $$;
