-- ADR 0019, D18 (slice S.12b.0: hardening before the first adapter). One new table, one index, and four columns
-- of "Provider" dropped with their five CHECKs. No historical migration is edited. It fails closed: every worker
-- attestation on record is gone with the columns, so no dispatch route is open until a worker of the new code
-- has said, in the new table, that it holds an adapter.
--
-- 1. An attestation per worker. Until now a provider's row held ONE attestation for the whole deployment, so a
--    worker that stopped withdrew it though another worker of the deployment was alive. Each worker process now
--    writes its own row (its own id), for one provider, with the deployment, the target and the generation of the
--    credential its adapter was built with, and removes only its own row when it stops. A worker that is killed
--    leaves a row that is no longer believed once it is older than the time allowed.
-- 2. "attestedAt" is written by the database's clock (now()), and its age is computed by the database
--    (clock_timestamp() - "attestedAt"): no process's clock is compared with another's. It is a point in time
--    (timestamptz), so the session's time zone, and a change of its daylight-saving offset, change nothing.
-- 3. The four columns the old attestation used are dropped. They are empty on every deployment that has not run
--    a dispatching worker (none has: no adapter exists). Code from before this migration can no longer attest.
-- 4. An index for the pass over operations that wait to be sent, which now walks them by id, a page at a time.
CREATE TABLE "ProviderWorkerAttestation" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "deployment" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "attestedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderWorkerAttestation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderWorkerAttestation_providerId_workerId_key" ON "ProviderWorkerAttestation"("providerId", "workerId");
ALTER TABLE "ProviderWorkerAttestation" ADD CONSTRAINT "ProviderWorkerAttestation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderWorkerAttestation" ADD CONSTRAINT "ProviderWorkerAttestation_target_known" CHECK ("target" IN ('sandbox', 'live'));
ALTER TABLE "ProviderWorkerAttestation" ADD CONSTRAINT "ProviderWorkerAttestation_deployment_form" CHECK ("deployment" ~ '^[a-z0-9][a-z0-9-]{2,62}$');
ALTER TABLE "ProviderWorkerAttestation" ADD CONSTRAINT "ProviderWorkerAttestation_generation_positive" CHECK ("generation" >= 1);
ALTER TABLE "ProviderWorkerAttestation" ADD CONSTRAINT "ProviderWorkerAttestation_workerId_form" CHECK ("workerId" ~ '^[A-Za-z0-9-]{8,64}$');

-- The CHECKs that name these columns go with them.
ALTER TABLE "Provider" DROP COLUMN "dispatchReadyAt", DROP COLUMN "dispatchReadyTarget", DROP COLUMN "dispatchReadyDeployment", DROP COLUMN "dispatchReadyGeneration";

CREATE INDEX "ProviderOperation_status_id_idx" ON "ProviderOperation"("status", "id");
