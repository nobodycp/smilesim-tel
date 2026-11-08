-- Package details: messages, minutes (null not stated, -1 unlimited) and extra text.
ALTER TABLE "Package" ADD COLUMN "smsCount" INTEGER, ADD COLUMN "minutes" INTEGER, ADD COLUMN "details" TEXT;
