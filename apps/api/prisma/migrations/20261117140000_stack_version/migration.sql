-- Versions (spec 2026-11-17-system-monitor, section 5; slice M.11): the newest published version of each component
-- the system runs on, one row a component, written by the version check; and the worker's own Node.js on its
-- heartbeat row. A new table and a new nullable column: nothing existing changes.
ALTER TABLE "WorkerHeartbeat" ADD COLUMN "nodeVersion" TEXT;

CREATE TABLE "StackVersion" (
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "latest" TEXT,
    "cycles" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "foundAt" TIMESTAMP(3),
    "previousLatest" TEXT,

    CONSTRAINT "StackVersion_pkey" PRIMARY KEY ("name")
);
