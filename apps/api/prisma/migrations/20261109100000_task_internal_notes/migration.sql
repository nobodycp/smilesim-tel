-- Tasks (spec 2026-11-09-offers-tasks-addons-wallet-esim, 2): internal notes for the branch, and no «بانتظار الاستلام»:
-- every open task is in progress.
ALTER TABLE "OfficeTaskNote" ADD COLUMN "internal" BOOLEAN NOT NULL DEFAULT false;
UPDATE "OfficeTask" SET "status" = 'working' WHERE "status" = 'pending';
