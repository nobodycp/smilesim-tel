-- Schema for settling an activation on a provider's verdict (ADR 0019, plan slice S.1). Additive only: new
-- nullable columns, two new tables, constraints on the new columns and tables. No existing column, row, index or
-- constraint is changed, and no code reads any of this yet.

-- ProviderOperation: its task (one operation per task), whether its verdict was applied, what the provider handed back.
ALTER TABLE "ProviderOperation"
  ADD COLUMN "taskId" TEXT,
  ADD COLUMN "appliedAt" TIMESTAMP(3),
  ADD COLUMN "applyError" TEXT,
  ADD COLUMN "applyFailedAt" TIMESTAMP(3),
  ADD COLUMN "resultMsisdn" TEXT,
  ADD COLUMN "resultIccid" TEXT,
  ADD COLUMN "resultEsimCode" TEXT;

-- A unique index leaves rows without a task alone (NULLs do not collide) and refuses a second operation for a task.
CREATE UNIQUE INDEX "ProviderOperation_taskId_key" ON "ProviderOperation"("taskId");
ALTER TABLE "ProviderOperation" ADD CONSTRAINT "ProviderOperation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OfficeTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderOperation" ADD CONSTRAINT "ProviderOperation_applyError_known" CHECK ("applyError" IS NULL OR "applyError" IN ('number-taken', 'sim-taken', 'target-missing'));
-- An eSIM activation code is stored sealed or not at all (shared/secret-box.ts writes `v1:`…).
ALTER TABLE "ProviderOperation" ADD CONSTRAINT "ProviderOperation_resultEsimCode_sealed" CHECK ("resultEsimCode" IS NULL OR "resultEsimCode" LIKE 'v1:%');

-- OfficeTask: the request it was opened by.
ALTER TABLE "OfficeTask"
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "requestHash" TEXT;
CREATE UNIQUE INDEX "OfficeTask_requestKey_key" ON "OfficeTask"("requestKey");

-- Provider: the owner's approval to dispatch, and the pause.
ALTER TABLE "Provider"
  ADD COLUMN "dispatchApprovedAt" TIMESTAMP(3),
  ADD COLUMN "dispatchApprovedByLoginName" TEXT,
  ADD COLUMN "dispatchPausedAt" TIMESTAMP(3);
-- An approval names who gave it.
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_dispatch_approval_named" CHECK (("dispatchApprovedAt" IS NULL) = ("dispatchApprovedByLoginName" IS NULL));

-- The record of decisions people take on an operation.
CREATE TABLE "ProviderDecisionEvent" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "evidenceKind" TEXT,
    "providerRef" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "suppliedEsimCode" BOOLEAN NOT NULL DEFAULT false,
    "accountId" TEXT NOT NULL,
    "accountLoginName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderDecisionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderDecisionEvent_operationId_sequence_key" ON "ProviderDecisionEvent"("operationId", "sequence");
-- RESTRICT: an operation that has a decision on record cannot be deleted from under it.
ALTER TABLE "ProviderDecisionEvent" ADD CONSTRAINT "ProviderDecisionEvent_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ProviderOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderDecisionEvent" ADD CONSTRAINT "ProviderDecisionEvent_sequence_positive" CHECK ("sequence" >= 1);
ALTER TABLE "ProviderDecisionEvent" ADD CONSTRAINT "ProviderDecisionEvent_type_known" CHECK ("type" IN ('proposed', 'approved', 'refused', 'applied'));
ALTER TABLE "ProviderDecisionEvent" ADD CONSTRAINT "ProviderDecisionEvent_decision_known" CHECK ("decision" IN ('confirm-success', 'declare-failure', 'apply-corrected', 'release-after-success'));
ALTER TABLE "ProviderDecisionEvent" ADD CONSTRAINT "ProviderDecisionEvent_evidenceKind_known" CHECK ("evidenceKind" IS NULL OR "evidenceKind" IN ('provider-portal', 'provider-statement', 'provider-answer', 'line-test'));
-- Whoever states a decision (a proposal, or a decision applied by one account) gives its evidence and a real note.
ALTER TABLE "ProviderDecisionEvent" ADD CONSTRAINT "ProviderDecisionEvent_evidence_given" CHECK ("type" NOT IN ('proposed', 'applied') OR ("evidenceKind" IS NOT NULL AND char_length(btrim("note")) >= 20));
-- Confirming a success names the provider's reference.
ALTER TABLE "ProviderDecisionEvent" ADD CONSTRAINT "ProviderDecisionEvent_success_referenced" CHECK ("decision" <> 'confirm-success' OR "type" NOT IN ('proposed', 'applied') OR char_length(btrim(coalesce("providerRef", ''))) > 0);
ALTER TABLE "ProviderDecisionEvent" ADD CONSTRAINT "ProviderDecisionEvent_account_named" CHECK (char_length("accountId") > 0 AND char_length("accountLoginName") > 0);

-- Append-only, whoever connects: a row is never changed or removed, and the table is never emptied.
CREATE FUNCTION "ProviderDecisionEvent_is_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ProviderDecisionEvent is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProviderDecisionEvent_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "ProviderDecisionEvent"
  FOR EACH ROW EXECUTE FUNCTION "ProviderDecisionEvent_is_append_only"();

CREATE TRIGGER "ProviderDecisionEvent_no_truncate"
  BEFORE TRUNCATE ON "ProviderDecisionEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "ProviderDecisionEvent_is_append_only"();

-- A provider's credentials, sealed, one per target.
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "sealedValue" TEXT NOT NULL,
    "updatedByLoginName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderCredential_providerId_target_key" ON "ProviderCredential"("providerId", "target");
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_target_known" CHECK ("target" IN ('sandbox', 'live'));
-- A credential is stored sealed or not at all.
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_sealed" CHECK ("sealedValue" LIKE 'v1:%');
