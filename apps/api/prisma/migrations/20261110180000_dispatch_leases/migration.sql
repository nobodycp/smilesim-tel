-- What the dispatcher and the outbox relay need to work safely with several workers (ADR 0018). Additive.
--   ProviderOperation.leaseUntil: until when the worker that claimed the attempt may still be working on it.
--   ProviderOperation.sentAt: written just before the provider is called; empty means the request never left.
--   OutboxMessage.claimedUntil: until when the relay that took the message may still be publishing it.

ALTER TABLE "ProviderOperation" ADD COLUMN "leaseUntil" TIMESTAMP(3);
ALTER TABLE "ProviderOperation" ADD COLUMN "sentAt" TIMESTAMP(3);
ALTER TABLE "OutboxMessage" ADD COLUMN "claimedUntil" TIMESTAMP(3);
