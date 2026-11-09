-- Money rows point at real rows (backend review 2026-11-10, M14).

-- A wallet entry written without a line carried an empty id; that is no line.
UPDATE "WalletEntry" SET "lineId" = NULL
WHERE "lineId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Line" WHERE "Line"."id" = "WalletEntry"."lineId");

UPDATE "OfficeTask" SET "nextPackageId" = NULL
WHERE "nextPackageId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Package" WHERE "Package"."id" = "OfficeTask"."nextPackageId");

-- AddForeignKey
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeTask" ADD CONSTRAINT "OfficeTask_posId_fkey" FOREIGN KEY ("posId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeTask" ADD CONSTRAINT "OfficeTask_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeTask" ADD CONSTRAINT "OfficeTask_nextPackageId_fkey" FOREIGN KEY ("nextPackageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Values the code never writes are refused by the database too. NOT VALID: rows already stored are left as they
-- are; every insert and update from now on is checked. (Prisma does not manage CHECK constraints.)
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_held_not_negative" CHECK ("held" >= 0) NOT VALID;
ALTER TABLE "Line" ADD CONSTRAINT "Line_status_known" CHECK ("status" IN ('active', 'frozen', 'disconnected', 'suspended')) NOT VALID;
ALTER TABLE "OfficeTask" ADD CONSTRAINT "OfficeTask_status_known" CHECK ("status" IN ('working', 'done', 'rejected', 'cancelled')) NOT VALID;
