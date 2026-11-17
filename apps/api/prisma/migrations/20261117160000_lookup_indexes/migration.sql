-- Foreign-key and lookup indexes (plan 2026-11-17-database-scale, DB.2; audit 2026-11-17, D.2). Indexes only: no
-- row changes. A plain CREATE INDEX: the tables are small today (spec 2026-11-17-scale-speed-cleanup).

-- A line's tasks (the line card; `openTaskOn` on every line operation) and the SET NULL of a deleted line.
CREATE INDEX "Task_lineId_idx" ON "Task"("lineId");

-- Foreign keys to the account that deleting an account checks (RESTRICT).
CREATE INDEX "WalletEntry_actorId_idx" ON "WalletEntry"("actorId");
CREATE INDEX "TaskNote_authorId_idx" ON "TaskNote"("authorId");

-- An account's sessions: the sessions list, revoking them, deleting the account.
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- The indexes below are ones Prisma cannot state, so the schema does not list them and `prisma migrate diff` does
-- not see them (like `Task_open_activation_iccid`).

-- The sweeper's walk over operations whose settlement still has to run (`unsettledPage`): by id, among the few not
-- yet applied, instead of every operation ever settled.
CREATE INDEX "ProviderOperation_unsettled_id" ON "ProviderOperation"("id")
  WHERE "taskId" IS NOT NULL AND "appliedAt" IS NULL;

-- Whether a task's note was already sent (`taskNoteSent`, inside the settlement's transaction): the query filters
-- the text key `payload->>'taskId'` this index serves.
CREATE INDEX "Notice_kind_taskId" ON "Notice"("kind", ("payload" ->> 'taskId'));
