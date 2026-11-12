-- ADR 0019, D18 (slice S.12a). Three nullable columns on "Provider" and four CHECKs; no historical migration is
-- edited. One row change, which fails closed: an approval on record with no target (none can exist, no route ever
-- wrote one) is withdrawn, because nothing says which target it was given for.
--
-- 1. The target an approval was given for. An approval is the owner saying "dispatch this provider on this
--    deployment". A deployment's target is a setting (PROVIDER_TARGET), so without the target on record an
--    approval given while the deployment was `sandbox` would still stand after the setting became `live`.
-- 2. What the worker attests: that it has built an adapter for this provider, for which target, and when it last
--    said so. The API and the worker are two processes with their own settings; the API opens the dispatch route
--    only on a fresh attestation, so a difference between the two never becomes a send.
ALTER TABLE "Provider" ADD COLUMN "dispatchApprovedTarget" TEXT;
ALTER TABLE "Provider" ADD COLUMN "dispatchReadyAt" TIMESTAMP(3);
ALTER TABLE "Provider" ADD COLUMN "dispatchReadyTarget" TEXT;

UPDATE "Provider" SET "dispatchApprovedAt" = NULL, "dispatchApprovedByLoginName" = NULL WHERE "dispatchApprovedAt" IS NOT NULL;

ALTER TABLE "Provider" ADD CONSTRAINT "Provider_dispatchApprovedTarget_known" CHECK ("dispatchApprovedTarget" IS NULL OR "dispatchApprovedTarget" IN ('sandbox', 'live'));
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_dispatchReadyTarget_known" CHECK ("dispatchReadyTarget" IS NULL OR "dispatchReadyTarget" IN ('sandbox', 'live'));
-- An approval always names its target, and a target is never on record without an approval.
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_dispatchApproval_whole" CHECK (("dispatchApprovedAt" IS NULL) = ("dispatchApprovedTarget" IS NULL));
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_dispatchReady_whole" CHECK (("dispatchReadyAt" IS NULL) = ("dispatchReadyTarget" IS NULL));
