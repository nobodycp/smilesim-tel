-- Offers (spec 2026-11-09-offers-tasks-addons-wallet-esim, 1): picture-and-text announcements shown as a hero
-- carousel on each account's home, for the layers chosen, each for its own number of seconds.
CREATE TABLE "Offer" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "image" TEXT,
  "actionLabel" TEXT,
  "actionHref" TEXT,
  "seconds" INTEGER NOT NULL DEFAULT 7,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0,
  "layers" TEXT NOT NULL DEFAULT 'branch,main_agent,agent,pos',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Offer_active_position_idx" ON "Offer"("active", "position");
