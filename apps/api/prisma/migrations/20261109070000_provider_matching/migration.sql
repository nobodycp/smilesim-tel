-- Provider matching, simulated until real providers are connected (spec 2026-11-08-overview-and-reports-nav, E).
-- `matchSource`: `api` matches each operation at once, `statement` matches periodically from a statement.
ALTER TABLE "Provider" ADD COLUMN "matchSource" TEXT NOT NULL DEFAULT 'statement',
  ADD COLUMN "matchEveryDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "lastMatchedAt" TIMESTAMP(3);
-- A demo split so both flows can be seen: two of the shipped providers answer through the (simulated) API.
UPDATE "Provider" SET "matchSource" = 'api' WHERE "code" IN ('alloha', 'sky');
