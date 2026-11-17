-- The system monitor's alerts (spec 2026-11-17-system-monitor, section 4; slice M.6). Written by the worker's alert
-- pass; read, marked seen and cleared (closed ones only) by the branch owner.
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "loginName" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT,
    "ip" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT '',
    "route" TEXT NOT NULL DEFAULT '',
    "path" TEXT NOT NULL DEFAULT '',
    "part" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL,
    "lastAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "seenById" TEXT,
    "seenByLoginName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Alert_state_lastAt_idx" ON "Alert"("state", "lastAt");
CREATE INDEX "Alert_lastAt_idx" ON "Alert"("lastAt");

-- At most one open alert a (kind, key): a second pass that finds the same rule passed raises the open one instead
-- of opening another. Closed alerts are history and may repeat. Partial, so it lives here and not in the schema.
CREATE UNIQUE INDEX "Alert_open_kind_key_key" ON "Alert"("kind", "key") WHERE "state" = 'open';
