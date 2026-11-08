-- Sign-in methods (roadmap N9): the 2FA method, and passkeys.
ALTER TABLE "User" ADD COLUMN "twoFactorMethod" TEXT NOT NULL DEFAULT 'app';

CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
