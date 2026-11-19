-- A sale is never written without its margins (ADR 0028, decision 4; spec 2026-11-19-business-lines-foundation,
-- F.3). `WalletLedger.post` refuses an entry of a sale kind (`SALE_KINDS`) that moves money out and has no ladder;
-- this CHECK says the same in the database. Before it a sale whose ladder could not be built was written with no
-- margins and no error, and every layer's profit on it was 0. A refund (`disconnect`, `amount` > 0) and the
-- loss-marked operations (`amount` = 0) are not sales that move money: untouched.
--
-- The kinds are the code's `SALE_KINDS` (kind-lists.spec.ts compares them with the latest definition here).
-- Added NOT VALID (no scan under the ACCESS EXCLUSIVE lock: every row written from now on is checked), then validated
-- only when no stored row breaks it, so this migration never fails a deployment: otherwise the CHECK is named in a
-- WARNING and stays NOT VALID (new writes are still checked). Validating reads the table once under SHARE UPDATE
-- EXCLUSIVE: reads and writes go on. `pg_constraint.convalidated` tells which. On 2026-11-19 the local data held 23
-- sales and none without its ladder; the trial server's stored-margins backfill reported 0 sales without one.
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_sale_has_ladder"
  CHECK (NOT ("kind" IN ('activate', 'charge', 'extend', 'reactivate') AND "amount" < 0) OR "ladder" IS NOT NULL) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "WalletEntry" WHERE "kind" IN ('activate', 'charge', 'extend', 'reactivate') AND "amount" < 0 AND "ladder" IS NULL
  ) THEN
    ALTER TABLE "WalletEntry" VALIDATE CONSTRAINT "WalletEntry_sale_has_ladder";
  ELSE
    RAISE WARNING 'WalletEntry_sale_has_ladder left NOT VALID: sales that moved money without their ladder are stored (stored-margins-backfill lists them)';
  END IF;
END $$;
