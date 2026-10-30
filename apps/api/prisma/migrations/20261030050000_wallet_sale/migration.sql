ALTER TABLE "WalletEntry" ADD COLUMN "msisdn" TEXT;
ALTER TABLE "WalletEntry" ADD COLUMN "lineId" TEXT;
ALTER TABLE "WalletEntry" ADD COLUMN "companyName" TEXT;
ALTER TABLE "WalletEntry" ADD COLUMN "packageName" TEXT;
ALTER TABLE "WalletEntry" ADD COLUMN "packagePrice" INTEGER;

UPDATE "WalletEntry" AS entry
SET
  "lineId" = line.id,
  "msisdn" = line.msisdn,
  "companyName" = company.name,
  "packageName" = package.name,
  "packagePrice" = CASE WHEN entry.amount <> 0 THEN abs(entry.amount) ELSE package."posPrice" END
FROM "Line" AS line
JOIN "Package" AS package ON package.id = line."packageId"
LEFT JOIN "Company" AS company ON company.id = package."companyId"
WHERE entry."userId" = line."posId"
  AND entry.kind IN ('activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'switch', 'rename', 'sim')
  AND (SELECT count(*) FROM "Line" AS other WHERE other."posId" = entry."userId") = 1;

CREATE INDEX "WalletEntry_lineId_idx" ON "WalletEntry"("lineId");
