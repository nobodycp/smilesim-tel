-- The old desk announcements board is gone (spec 2026-11-09-admin-review, 6.2): the offers hero is the one
-- announcements system. Its notices go with it.
DELETE FROM "Notice" WHERE "kind" = 'announcement';
DROP TABLE "Announcement";
