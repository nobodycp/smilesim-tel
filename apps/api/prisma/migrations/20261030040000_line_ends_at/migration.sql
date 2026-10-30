ALTER TABLE "Line" ADD COLUMN "endsAt" TIMESTAMP(3);

UPDATE "Line" AS line
SET "endsAt" = line."createdAt" + (make_interval(months => package.months))
FROM "Package" AS package
WHERE package.id = line."packageId";

UPDATE "Line" SET "endsAt" = "createdAt" WHERE "endsAt" IS NULL;

ALTER TABLE "Line" ALTER COLUMN "endsAt" SET NOT NULL;
