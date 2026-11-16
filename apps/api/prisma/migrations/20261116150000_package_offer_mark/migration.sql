-- A package may be marked as an offer, with a short line that says what the offer is (spec 2026-11-16-package-page,
-- P.7). A mark for the screens only: no price or renewal reads it.
ALTER TABLE "Package" ADD COLUMN "offer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Package" ADD COLUMN "offerNote" TEXT;
