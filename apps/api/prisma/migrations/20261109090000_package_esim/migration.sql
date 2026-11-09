-- eSIM per package (spec 2026-11-09-offers-tasks-addons-wallet-esim, 5): a package can refuse eSIM even when its
-- company offers it.
ALTER TABLE "Package" ADD COLUMN "esimAvailable" BOOLEAN NOT NULL DEFAULT true;
