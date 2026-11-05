-- Append-only office activity. The worker hard-deletes rows older than 90 days.
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorLogin" TEXT NOT NULL DEFAULT '',
    "actorLayer" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "subjectKind" TEXT NOT NULL DEFAULT '',
    "subjectRef" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivityEvent_at_idx" ON "ActivityEvent"("at");
CREATE INDEX "ActivityEvent_actorId_at_idx" ON "ActivityEvent"("actorId", "at");
CREATE INDEX "ActivityEvent_action_at_idx" ON "ActivityEvent"("action", "at");

ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
