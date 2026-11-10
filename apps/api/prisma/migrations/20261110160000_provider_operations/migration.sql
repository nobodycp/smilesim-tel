-- The durable record of what is asked of a provider, and the outbox that says an operation waits to be sent
-- (ADR 0017). Additive: two new tables, nothing existing is changed, no code path writes them yet.

CREATE TABLE "ProviderOperation" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "packageCode" TEXT NOT NULL,
    "msisdn" TEXT,
    "iccid" TEXT,
    "lineId" TEXT,
    "status" TEXT NOT NULL,
    "providerRef" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderOperation_idempotencyKey_key" ON "ProviderOperation"("idempotencyKey");
CREATE INDEX "ProviderOperation_status_updatedAt_idx" ON "ProviderOperation"("status", "updatedAt");
CREATE INDEX "ProviderOperation_providerId_createdAt_idx" ON "ProviderOperation"("providerId", "createdAt");
CREATE INDEX "ProviderOperation_lineId_idx" ON "ProviderOperation"("lineId");

ALTER TABLE "ProviderOperation" ADD CONSTRAINT "ProviderOperation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderOperation" ADD CONSTRAINT "ProviderOperation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The database refuses a state the code does not handle (backend-engineering.mdc 2.4).
ALTER TABLE "ProviderOperation" ADD CONSTRAINT "ProviderOperation_status_known" CHECK ("status" IN ('requested', 'pending', 'succeeded', 'failed', 'unknown'));
ALTER TABLE "ProviderOperation" ADD CONSTRAINT "ProviderOperation_attempts_not_negative" CHECK ("attempts" >= 0);

CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutboxMessage_publishedAt_createdAt_idx" ON "OutboxMessage"("publishedAt", "createdAt");
CREATE INDEX "OutboxMessage_aggregateId_idx" ON "OutboxMessage"("aggregateId");
