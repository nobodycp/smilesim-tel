-- Reconciliation with providers (roadmap N8).
ALTER TABLE "Provider" ADD COLUMN "statementMap" JSONB;

CREATE TABLE "ProviderReconciliation" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "statementTotal" INTEGER NOT NULL,
    "ourTotal" INTEGER NOT NULL,
    "counts" JSONB NOT NULL,
    "actorLogin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderReconciliation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProviderReconciliation_providerId_createdAt_idx" ON "ProviderReconciliation"("providerId", "createdAt");
ALTER TABLE "ProviderReconciliation" ADD CONSTRAINT "ProviderReconciliation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProviderReconItem" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "at" TIMESTAMP(3),
    "theirAmount" INTEGER,
    "ourAmount" INTEGER,
    "ourEntryId" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "ProviderReconItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProviderReconItem_reconciliationId_idx" ON "ProviderReconItem"("reconciliationId");
ALTER TABLE "ProviderReconItem" ADD CONSTRAINT "ProviderReconItem_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "ProviderReconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
