-- What the branch pays the provider for the whole period a prepaid row bought, kept on the row so a disconnect
-- or a switch values the running period by what it cost, not by the line's later terms. Nullable, no backfill:
-- older rows fall back to the terms as before.
ALTER TABLE "WalletEntry" ADD COLUMN "periodCost" INTEGER;
