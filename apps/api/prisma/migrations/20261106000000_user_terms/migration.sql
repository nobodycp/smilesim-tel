-- PackageOffer becomes UserPackage: hidden flag, nullable subscription price, renewal price.
ALTER TABLE "PackageOffer" RENAME TO "UserPackage";
ALTER TABLE "UserPackage" RENAME CONSTRAINT "PackageOffer_pkey" TO "UserPackage_pkey";
ALTER INDEX "PackageOffer_packageId_userId_key" RENAME TO "UserPackage_packageId_userId_key";
ALTER TABLE "UserPackage" RENAME CONSTRAINT "PackageOffer_packageId_fkey" TO "UserPackage_packageId_fkey";
ALTER TABLE "UserPackage" RENAME CONSTRAINT "PackageOffer_userId_fkey" TO "UserPackage_userId_fkey";
ALTER TABLE "UserPackage"
  ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "renewalPrice" INTEGER,
  ADD COLUMN "setById" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "UserPackage" ALTER COLUMN "price" DROP NOT NULL;
-- An old offer was charged for both subscription and renewal; keep the renewal charge unchanged.
UPDATE "UserPackage" SET "renewalPrice" = "price" WHERE "renewalPrice" IS NULL;

-- A non-branch parent's default sell price to its direct children.
CREATE TABLE "SellPrice" (
  "id" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "price" INTEGER NOT NULL,
  "renewalPrice" INTEGER,
  CONSTRAINT "SellPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SellPrice_packageId_ownerId_key" ON "SellPrice"("packageId", "ownerId");
ALTER TABLE "SellPrice" ADD CONSTRAINT "SellPrice_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellPrice" ADD CONSTRAINT "SellPrice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Line operations stopped on an account; inherited by everyone under it.
ALTER TABLE "User" ADD COLUMN "deniedOps" TEXT NOT NULL DEFAULT '';
