-- When the overdue-matching notice was sent (spec 2026-11-08-overview-and-reports-nav, E), so it is sent once per lapse.
ALTER TABLE "Provider" ADD COLUMN "matchOverdueNoticeAt" TIMESTAMP(3);
