-- eSIM price: the company default, overridden by the provider, overridden by the package.
ALTER TABLE "Company" ADD COLUMN "esimPrice" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "Provider" ADD COLUMN "esimPrice" INTEGER;
ALTER TABLE "Package" ADD COLUMN "esimPrice" INTEGER;
-- The QR picture the provider handed the branch for an eSIM, as a data URL. A task holds it until it completes.
ALTER TABLE "Line" ADD COLUMN "esimQr" TEXT;
ALTER TABLE "OfficeTask" ADD COLUMN "esimQr" TEXT;
