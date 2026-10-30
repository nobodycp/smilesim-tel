-- Trial office: wallets, the two packages, lines, and branch tasks.

CREATE TABLE "Wallet" (
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "ceiling" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "WalletEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "branchCost" INTEGER NOT NULL,
    "mainPrice" INTEGER NOT NULL,
    "agentPrice" INTEGER NOT NULL,
    "posPrice" INTEGER NOT NULL,
    "subscriberPrice" INTEGER NOT NULL,
    "autoActivate" BOOLEAN NOT NULL,
    "autoCharge" BOOLEAN NOT NULL,
    "autoDisconnect" BOOLEAN NOT NULL,
    "autoFreeze" BOOLEAN NOT NULL,
    "autoSwitch" BOOLEAN NOT NULL,
    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Line" (
    "id" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "iccid" TEXT,
    "esim" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "posId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Line_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfficeTask" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "posId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "lineId" TEXT,
    "submitterId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "posDelta" INTEGER NOT NULL,
    "msisdn" TEXT,
    "iccid" TEXT,
    "esim" BOOLEAN NOT NULL DEFAULT false,
    "nextPackageId" TEXT,
    "note" TEXT,
    "resultNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OfficeTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Provider_code_key" ON "Provider"("code");
CREATE UNIQUE INDEX "Package_code_key" ON "Package"("code");
CREATE UNIQUE INDEX "Line_msisdn_key" ON "Line"("msisdn");
CREATE INDEX "WalletEntry_userId_createdAt_idx" ON "WalletEntry"("userId", "createdAt");
CREATE INDEX "Line_posId_createdAt_idx" ON "Line"("posId", "createdAt");
CREATE INDEX "OfficeTask_status_createdAt_idx" ON "OfficeTask"("status", "createdAt");
CREATE INDEX "OfficeTask_submitterId_createdAt_idx" ON "OfficeTask"("submitterId", "createdAt");

ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Package" ADD CONSTRAINT "Package_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Line" ADD CONSTRAINT "Line_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Line" ADD CONSTRAINT "Line_posId_fkey" FOREIGN KEY ("posId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeTask" ADD CONSTRAINT "OfficeTask_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OfficeTask" ADD CONSTRAINT "OfficeTask_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeTask" ADD CONSTRAINT "OfficeTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
