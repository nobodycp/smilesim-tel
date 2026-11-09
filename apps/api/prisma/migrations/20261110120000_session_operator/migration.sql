-- An entered (impersonation) session keeps who entered, so the wallet entries and the activity log name the real
-- actor without trusting a cookie (backend review 2026-11-10, S7).
ALTER TABLE "Session" ADD COLUMN "operatorId" TEXT;
