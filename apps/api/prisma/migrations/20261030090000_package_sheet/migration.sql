ALTER TABLE "Package" ADD COLUMN "allowActivate" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Package" ADD COLUMN "allowCharge" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Package" ADD COLUMN "allowFreeze" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Package" ADD COLUMN "allowSwitch" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Package" ADD COLUMN "allowExtend" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Package" ADD COLUMN "allowRename" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Package" ADD COLUMN "allowSim" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Package" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "PackageOffer" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    CONSTRAINT "PackageOffer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PackageOffer_packageId_userId_key" ON "PackageOffer"("packageId", "userId");
ALTER TABLE "PackageOffer" ADD CONSTRAINT "PackageOffer_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackageOffer" ADD CONSTRAINT "PackageOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
