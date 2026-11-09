-- The home donut's change over the period (spec 2026-11-09-admin-review, 6.4): one viewer's line counts per UTC day,
-- the last read of that day. History starts with this table.
CREATE TABLE "LineCountSnapshot" (
  "userId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "active" INTEGER NOT NULL,
  "expiring" INTEGER NOT NULL,
  "frozen" INTEGER NOT NULL,
  "disconnected" INTEGER NOT NULL,
  "suspended" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LineCountSnapshot_pkey" PRIMARY KEY ("userId", "day")
);
