-- Provider accounts (roadmap N7): a credit limit per provider, and its payments and settlements.
ALTER TABLE "Provider" ADD COLUMN "creditLimit" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ProviderEntry" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "actorLogin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderEntry_providerId_createdAt_idx" ON "ProviderEntry"("providerId", "createdAt");

ALTER TABLE "ProviderEntry" ADD CONSTRAINT "ProviderEntry_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
