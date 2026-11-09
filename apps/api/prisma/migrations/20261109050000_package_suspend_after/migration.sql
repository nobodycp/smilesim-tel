-- Suspended lines (spec 2026-11-08-overview-and-reports-nav, I): a line is suspended once its subscription ended this
-- many days ago; each package has its own period, 90 by default.
ALTER TABLE "Package" ADD COLUMN "suspendAfterDays" INTEGER NOT NULL DEFAULT 90;
