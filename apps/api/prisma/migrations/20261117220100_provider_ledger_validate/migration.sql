-- The provider ledger's CHECK validated (ADR 0025, slice P.3). `WalletEntry_operation_priced` was added NOT VALID by
-- 20261117210000_provider_ledger_stored: every row written since is checked, the rows stored before were not. The
-- backfill command of that release (`provider-ledger-backfill`) gives those rows their provider and cost; the
-- reads of this release are sums of them, so an operation entry without them would be in no provider's books.
--
-- Validated only when no stored row breaks it, so this migration never fails a deployment whose backfill has not
-- run: the CHECK is then named in a WARNING and stays NOT VALID (new writes are still checked). The operator runs the
-- backfill before this release (docs/handover/technical-operations-ar.md) and checks `pg_constraint.convalidated`
-- after it. Validating reads the table once under SHARE UPDATE EXCLUSIVE: reads and writes go on.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "WalletEntry"
    WHERE NOT ("kind" NOT IN ('activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch',
                              'rename', 'sim', 'esim', 'refresh', 'transfer')
               OR ("providerId" IS NOT NULL AND "providerCost" IS NOT NULL))
  ) THEN
    ALTER TABLE "WalletEntry" VALIDATE CONSTRAINT "WalletEntry_operation_priced";
  ELSE
    RAISE WARNING 'WalletEntry_operation_priced left NOT VALID: operation entries without a provider or a cost are stored (run provider-ledger-backfill of the previous release)';
  END IF;
END $$;
