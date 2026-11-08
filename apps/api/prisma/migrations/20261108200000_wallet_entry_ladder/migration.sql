-- Each sale keeps the price chain it was made at, so every layer can see what it earned (roadmap N4).
ALTER TABLE "WalletEntry" ADD COLUMN "ladder" JSONB;
