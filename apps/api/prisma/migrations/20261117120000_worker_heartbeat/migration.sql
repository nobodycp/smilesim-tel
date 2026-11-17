-- The worker's heartbeat (spec 2026-11-17-system-monitor, slice M.5): one row a worker process, its time written by
-- the database's clock ("now()") every 20 s, read by the system status on the same clock.
CREATE TABLE "WorkerHeartbeat" (
    "workerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "beatAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

CREATE INDEX "WorkerHeartbeat_beatAt_idx" ON "WorkerHeartbeat"("beatAt");
