-- ADR 0019, D16 (amended in slice S.8, approved by the owner on 2026-11-12): a fourth reason a succeeded
-- provider operation cannot be applied. The provider confirmed an eSIM activation and handed back no activation
-- code, and the task carries none: no line is created without its code. The list stays closed; it gains one value.
--
-- The earlier migration (20261110190000_activation_settlement_schema) is not edited: its constraint is replaced
-- here. Every row the old constraint accepted is accepted by the new one, so this cannot fail on existing data.
ALTER TABLE "ProviderOperation" DROP CONSTRAINT "ProviderOperation_applyError_known";
ALTER TABLE "ProviderOperation" ADD CONSTRAINT "ProviderOperation_applyError_known" CHECK ("applyError" IS NULL OR "applyError" IN ('number-taken', 'sim-taken', 'target-missing', 'esim-code-missing'));
