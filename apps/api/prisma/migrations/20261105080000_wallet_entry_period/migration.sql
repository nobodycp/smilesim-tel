-- A row that buys time records the period it bought, so a disconnect or a switch can value every paid day left.
ALTER TABLE "WalletEntry" ADD COLUMN "periodDays" INTEGER;
ALTER TABLE "WalletEntry" ADD COLUMN "periodEndsAt" TIMESTAMP(3);
