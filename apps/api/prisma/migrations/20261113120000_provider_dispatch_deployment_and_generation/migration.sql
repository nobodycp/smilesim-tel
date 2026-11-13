-- ADR 0019, D18 (final corrections of slice S.12a). Three nullable columns on "Provider", one column on
-- "ProviderCredential", six CHECKs; no historical migration is edited. Two row changes, both fail closed:
-- every approval and every worker attestation on record is withdrawn, because none names a deployment.
--
-- 1. An approval is the owner saying "dispatch this provider on THIS deployment". A target (`sandbox`, `live`) is
--    not a deployment: two deployments of the same target that share a database, or a database restored from
--    another deployment's backup, would have carried the approval with them. The approval and the worker's
--    attestation now name the deployment (`DEPLOYMENT_ID`) they were given on, and stand for no other.
-- 2. A credential has a generation, raised by every write of it. A worker attests the generation its adapter was
--    built with, and sends only while that is still the stored one: a worker that still holds a replaced
--    credential can neither attest nor send.
ALTER TABLE "Provider" ADD COLUMN "dispatchApprovedDeployment" TEXT;
ALTER TABLE "Provider" ADD COLUMN "dispatchReadyDeployment" TEXT;
ALTER TABLE "Provider" ADD COLUMN "dispatchReadyGeneration" INTEGER;
ALTER TABLE "ProviderCredential" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1;

UPDATE "Provider" SET "dispatchApprovedAt" = NULL, "dispatchApprovedByLoginName" = NULL, "dispatchApprovedTarget" = NULL WHERE "dispatchApprovedAt" IS NOT NULL;
UPDATE "Provider" SET "dispatchReadyAt" = NULL, "dispatchReadyTarget" = NULL WHERE "dispatchReadyAt" IS NOT NULL;

-- A deployment's name as `DEPLOYMENT_ID` may state it.
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_dispatchApprovedDeployment_form" CHECK ("dispatchApprovedDeployment" IS NULL OR "dispatchApprovedDeployment" ~ '^[a-z0-9][a-z0-9-]{2,62}$');
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_dispatchReadyDeployment_form" CHECK ("dispatchReadyDeployment" IS NULL OR "dispatchReadyDeployment" ~ '^[a-z0-9][a-z0-9-]{2,62}$');
-- An approval always names its deployment, and an attestation its deployment and its credential's generation.
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_dispatchApprovalDeployment_whole" CHECK (("dispatchApprovedAt" IS NULL) = ("dispatchApprovedDeployment" IS NULL));
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_dispatchReadyIdentity_whole" CHECK (("dispatchReadyAt" IS NULL) = ("dispatchReadyDeployment" IS NULL) AND ("dispatchReadyAt" IS NULL) = ("dispatchReadyGeneration" IS NULL));
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_dispatchReadyGeneration_positive" CHECK ("dispatchReadyGeneration" IS NULL OR "dispatchReadyGeneration" >= 1);
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_generation_positive" CHECK ("generation" >= 1);
