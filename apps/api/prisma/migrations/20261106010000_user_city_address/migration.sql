-- The profile names a city (a key from the Palestinian city list) and a free-text address.
ALTER TABLE "User" ADD COLUMN "city" TEXT;
ALTER TABLE "User" ADD COLUMN "address" TEXT;
