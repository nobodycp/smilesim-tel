ALTER TABLE "OfficeTask" ADD COLUMN "log" TEXT NOT NULL DEFAULT '';

CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "targetLogin" TEXT NOT NULL,
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccessLog_actorId_createdAt_idx" ON "AccessLog"("actorId", "createdAt");

ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
