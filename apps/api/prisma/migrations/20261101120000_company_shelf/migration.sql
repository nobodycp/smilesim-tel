ALTER TABLE "Company" DROP CONSTRAINT "Company_providerId_fkey";
ALTER TABLE "Company" DROP COLUMN "providerId";

ALTER TABLE "Package" ADD COLUMN "forSale" BOOLEAN;
ALTER TABLE "Package" ADD COLUMN "renewalBranchCost" INTEGER;
ALTER TABLE "Package" ADD COLUMN "renewalMainPrice" INTEGER;
ALTER TABLE "Package" ADD COLUMN "renewalAgentPrice" INTEGER;
ALTER TABLE "Package" ADD COLUMN "renewalPosPrice" INTEGER;
ALTER TABLE "Package" ADD COLUMN "renewalSubscriberPrice" INTEGER;

UPDATE "Package"
SET
    "forSale" = "enabled",
    "renewalBranchCost" = "branchCost",
    "renewalMainPrice" = "mainPrice",
    "renewalAgentPrice" = "agentPrice",
    "renewalPosPrice" = "posPrice",
    "renewalSubscriberPrice" = "subscriberPrice";

ALTER TABLE "Package" ALTER COLUMN "forSale" SET DEFAULT true;
ALTER TABLE "Package" ALTER COLUMN "forSale" SET NOT NULL;
ALTER TABLE "Package" ALTER COLUMN "renewalBranchCost" SET NOT NULL;
ALTER TABLE "Package" ALTER COLUMN "renewalMainPrice" SET NOT NULL;
ALTER TABLE "Package" ALTER COLUMN "renewalAgentPrice" SET NOT NULL;
ALTER TABLE "Package" ALTER COLUMN "renewalPosPrice" SET NOT NULL;
ALTER TABLE "Package" ALTER COLUMN "renewalSubscriberPrice" SET NOT NULL;

CREATE TABLE "PackageRenewal" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "targetPackageId" TEXT NOT NULL,
    CONSTRAINT "PackageRenewal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackageSwitch" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "targetPackageId" TEXT NOT NULL,
    CONSTRAINT "PackageSwitch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PackageRenewal_packageId_targetPackageId_key" ON "PackageRenewal"("packageId", "targetPackageId");
CREATE UNIQUE INDEX "PackageSwitch_packageId_targetPackageId_key" ON "PackageSwitch"("packageId", "targetPackageId");

ALTER TABLE "PackageRenewal" ADD CONSTRAINT "PackageRenewal_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageRenewal" ADD CONSTRAINT "PackageRenewal_targetPackageId_fkey" FOREIGN KEY ("targetPackageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageSwitch" ADD CONSTRAINT "PackageSwitch_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackageSwitch" ADD CONSTRAINT "PackageSwitch_targetPackageId_fkey" FOREIGN KEY ("targetPackageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Line" ADD COLUMN "terms" JSONB;

UPDATE "Line"
SET "terms" = jsonb_build_object(
    'packageCode', "Package"."code",
    'months', "Package"."months",
    'subscription', jsonb_build_object(
        'branchCost', "Package"."branchCost",
        'mainPrice', "Package"."mainPrice",
        'agentPrice', "Package"."agentPrice",
        'posPrice', "Package"."posPrice",
        'subscriberPrice', "Package"."subscriberPrice"
    ),
    'renewal', jsonb_build_object(
        'branchCost', "Package"."branchCost",
        'mainPrice', "Package"."mainPrice",
        'agentPrice', "Package"."agentPrice",
        'posPrice', "Package"."posPrice",
        'subscriberPrice', "Package"."subscriberPrice"
    ),
    'renewalTargets', jsonb_build_array()
)
FROM "Package"
WHERE "Line"."packageId" = "Package"."id";

ALTER TABLE "Line" ALTER COLUMN "terms" SET NOT NULL;
