-- The full wallet (roadmap N6): money held for open tasks, and the reason of a manual movement.
ALTER TABLE "Wallet" ADD COLUMN "held" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OfficeTask" ADD COLUMN "held" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WalletEntry" ADD COLUMN "reason" TEXT;
ALTER TABLE "WalletEntry" ADD COLUMN "held" INTEGER;
