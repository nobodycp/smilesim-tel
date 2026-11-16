-- A package's durations, each with its own price ladder (spec 2026-11-15-package-durations-and-deals, plan D.2).
-- Every existing package gets one row: its months and its renewal prices. The package's own columns stay and are
-- written together with that row until plan D.10 removes them.
CREATE TABLE "PackageDuration" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "branchCost" INTEGER NOT NULL,
    "mainPrice" INTEGER NOT NULL,
    "agentPrice" INTEGER NOT NULL,
    "posPrice" INTEGER NOT NULL,
    "subscriberPrice" INTEGER NOT NULL,
    "noDisconnect" BOOLEAN NOT NULL DEFAULT false,
    "forSale" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "providerProductCode" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageDuration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PackageDuration_unit_check" CHECK ("unit" IN ('day', 'month')),
    CONSTRAINT "PackageDuration_count_check" CHECK ("count" > 0)
);

CREATE UNIQUE INDEX "PackageDuration_packageId_unit_count_key" ON "PackageDuration"("packageId", "unit", "count");

ALTER TABLE "PackageDuration" ADD CONSTRAINT "PackageDuration_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PackageDuration" ("id", "packageId", "unit", "count", "branchCost", "mainPrice", "agentPrice", "posPrice", "subscriberPrice")
SELECT gen_random_uuid()::text, p."id", 'month', GREATEST(p."months", 1),
       p."renewalBranchCost", p."renewalMainPrice", p."renewalAgentPrice", p."renewalPosPrice", p."renewalSubscriberPrice"
FROM "Package" p;
