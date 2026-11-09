-- A task keeps the price it was opened at, so completion charges and records the same number.
ALTER TABLE "OfficeTask" ADD COLUMN "unitPrice" INTEGER;

-- «بانتظار الاستلام» was retired on 2026-11-09: nothing handles a pending task any more. Tasks that a frozen
-- handler left pending go back to the pool as working, unassigned.
UPDATE "OfficeTask" SET "status" = 'working', "assigneeId" = NULL WHERE "status" = 'pending';
