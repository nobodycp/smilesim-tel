-- The eSIM fee folded into a wallet entry's amount (eSIM activation or eSIM issue).
ALTER TABLE "WalletEntry" ADD COLUMN "esimPrice" INTEGER;
