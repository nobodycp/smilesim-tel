-- The session cookie carries a token and the database keeps only its hash (backend review 2026-11-10, S6).
-- Until now the cookie was the row's id. Each existing row gets the hash of its id, so a browser that still holds
-- an old cookie stays signed in; new sessions get a random token that is stored nowhere.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE "Session" ADD COLUMN "tokenHash" TEXT;
UPDATE "Session" SET "tokenHash" = encode(digest("id", 'sha256'), 'hex');
ALTER TABLE "Session" ALTER COLUMN "tokenHash" SET NOT NULL;
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
