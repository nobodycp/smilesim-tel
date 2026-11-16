-- The request log of the system monitor (spec 2026-11-17-system-monitor, slice M.1): one row an HTTP request,
-- written in batches by the API. No body, cookie, query string or header value but the user agent is ever stored.
-- No foreign key to "User": a row outlives its account, and a batch insert needs no join.
CREATE TABLE "RequestLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL DEFAULT '',
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "actorLoginName" TEXT NOT NULL DEFAULT '',
    "operatorId" TEXT,
    "layer" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "requestId" TEXT NOT NULL,
    "bytesIn" INTEGER NOT NULL DEFAULT 0,
    "bytesOut" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RequestLog_at_idx" ON "RequestLog"("at");
CREATE INDEX "RequestLog_status_at_idx" ON "RequestLog"("status", "at");
CREATE INDEX "RequestLog_route_at_idx" ON "RequestLog"("route", "at");
CREATE INDEX "RequestLog_actorId_at_idx" ON "RequestLog"("actorId", "at");
CREATE INDEX "RequestLog_ip_at_idx" ON "RequestLog"("ip", "at");
