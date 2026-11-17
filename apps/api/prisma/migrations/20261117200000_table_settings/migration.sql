-- Table settings (plan 2026-11-17-database-scale, DB.15; audit 2026-11-17 sections 7, 9 and 10). Prisma cannot state
-- storage parameters or a constraint's validation, so `prisma migrate diff` sees none of this; `schema.prisma`
-- names each beside its model and `scripts/backup/rehearse-upgrade.sh` checks the storage parameters.
--
-- Every statement takes a SHARE UPDATE EXCLUSIVE lock on its table: reads and writes go on, only another schema
-- change, a VACUUM or an index build waits. No table is rewritten: a fill factor applies to pages written from now
-- on, and the autovacuum settings to the next pass.

-- Room on each page for the next version of a row, so the frequent updates of a wallet's balance and hold, and of
-- a session's last activity, stay on the same page (HOT: no index entry written). Neither column is indexed.
ALTER TABLE "Wallet" SET (fillfactor = 70);
ALTER TABLE "Session" SET (fillfactor = 80);

-- The daily purges delete from the activity log (and the request log, set in 20261117180000_request_log_indexes);
-- vacuum reclaims the space once 2 % of the rows are dead, instead of PostgreSQL's 20 %.
ALTER TABLE "ActivityEvent" SET (autovacuum_vacuum_scale_factor = 0.02);

-- The planner's statistics follow the newest rows (every "newest first" list depends on them): analysed once 2 % of
-- the rows changed, instead of 10 %.
ALTER TABLE "WalletEntry" SET (autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE "Line" SET (autovacuum_analyze_scale_factor = 0.02);

-- The three CHECKs of 20261110110000_task_and_entry_keys were added NOT VALID: every write since is checked, the
-- rows stored before were not. Each is validated only when no stored row breaks it, so this migration never fails
-- on old data: a constraint left unvalidated is named in a WARNING and stays NOT VALID, and new writes are still
-- checked. Validating reads the table once (SHARE UPDATE EXCLUSIVE: writes go on). `pg_constraint.convalidated`
-- tells which were validated.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Wallet" WHERE NOT ("held" >= 0)) THEN
    ALTER TABLE "Wallet" VALIDATE CONSTRAINT "Wallet_held_not_negative";
  ELSE
    RAISE WARNING 'Wallet_held_not_negative left NOT VALID: stored rows break it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Line" WHERE NOT ("status" IN ('active', 'frozen', 'disconnected', 'suspended'))) THEN
    ALTER TABLE "Line" VALIDATE CONSTRAINT "Line_status_known";
  ELSE
    RAISE WARNING 'Line_status_known left NOT VALID: stored rows break it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Task" WHERE NOT ("status" IN ('working', 'done', 'rejected', 'cancelled'))) THEN
    ALTER TABLE "Task" VALIDATE CONSTRAINT "Task_status_known";
  ELSE
    RAISE WARNING 'Task_status_known left NOT VALID: stored rows break it';
  END IF;
END $$;
