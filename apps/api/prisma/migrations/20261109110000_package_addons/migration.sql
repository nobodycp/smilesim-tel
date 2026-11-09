-- Line add-ons (spec 2026-11-09-offers-tasks-addons-wallet-esim, 3): extra operations named per package by hand;
-- requesting one opens a manual task that holds its price and charges it when done.
CREATE TABLE "PackageAddon" (
  "id" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "price" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PackageAddon_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PackageAddon_packageId_position_idx" ON "PackageAddon"("packageId", "position");
ALTER TABLE "PackageAddon" ADD CONSTRAINT "PackageAddon_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
