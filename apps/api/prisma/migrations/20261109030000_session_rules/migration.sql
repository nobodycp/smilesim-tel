-- Session rules per layer and per account: sessions allowed and idle minutes; null follows the next level.
ALTER TABLE "LayerPolicy" ADD COLUMN "maxSessions" INTEGER, ADD COLUMN "sessionMinutes" INTEGER;
ALTER TABLE "User" ADD COLUMN "maxSessions" INTEGER, ADD COLUMN "sessionMinutes" INTEGER;
