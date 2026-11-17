-- The server errors of the system monitor (spec 2026-11-17-system-monitor, slice M.4): one row a request that ended
-- in 5xx, beside its "RequestLog" row (the same "requestId"). Only the error's class, a code for its message and
-- the top frames of its stack are stored, never the message's words or a value of the request.
CREATE TABLE "RequestError" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "RequestError_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RequestError_at_idx" ON "RequestError"("at");
CREATE INDEX "RequestError_route_at_idx" ON "RequestError"("route", "at");
CREATE INDEX "RequestError_requestId_idx" ON "RequestError"("requestId");
