-- Packages added from the provider (spec 2026-11-09-admin-review, 3): the run modes a package inherits from its
-- provider, and the provider product it came from (one package per product and provider). Existing packages inherit
-- nothing: their stored modes stay their own, so nothing they do changes.
ALTER TABLE "Package" ADD COLUMN "inheritedModes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Package" ADD COLUMN "providerProductCode" TEXT;
CREATE UNIQUE INDEX "Package_providerId_providerProductCode_key" ON "Package"("providerId", "providerProductCode");
