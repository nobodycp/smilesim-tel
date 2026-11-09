-- Provider health and alerts (spec 2026-11-08-overview-and-reports-nav, G): the owner's floor for the available
-- balance, and the last known status so a change is noticed once.
ALTER TABLE "Provider" ADD COLUMN "alertFloor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "health" TEXT NOT NULL DEFAULT 'working',
  ADD COLUMN "healthReason" TEXT,
  ADD COLUMN "healthAt" TIMESTAMP(3);
