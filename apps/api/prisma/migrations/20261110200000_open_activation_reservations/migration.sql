-- An open activation task reserves its SIM serial and its number (ADR 0019, D5; plan slice S.2): the database
-- refuses a second open activation task for the same serial or the same number. The reservation ends when the
-- task leaves 'working' (done, rejected, cancelled): no row is deleted for that.
--
-- ONE statement, on purpose: a DO block either finishes or changes nothing, by PostgreSQL's own rule. That must not
-- depend on the migration runner. Measured on Prisma Migrate 7.10.1: a migration made of two plain CREATE INDEX
-- statements kept the first index when the second failed and was left recorded as failed; a file that also held a
-- DO block happened to be rolled back as a whole, which Prisma does not document or promise.
--
-- The table is locked against writes while this runs, so no task can be opened between the check and the indexes;
-- reads go on. If the lock is not granted in 30 s the migration fails with nothing changed and is run again.
--
-- If open activation tasks already share a serial or a number, it stops and names the tasks by id. It never
-- closes, changes or deletes a task: the branch rejects, or the submitter cancels, all but one of each group, then
-- the migration is run again. Serials and numbers are shown by their last four characters only: this message ends
-- up in deploy logs. `npm run reservation-conflicts --workspace api` lists the same groups without changing
-- anything, and is meant to be run before a deploy.

DO $$
DECLARE
  found text;
BEGIN
  PERFORM set_config('lock_timeout', '30s', true);
  LOCK TABLE "OfficeTask" IN SHARE ROW EXCLUSIVE MODE;

  SELECT string_agg(format('  %s ending %s: tasks %s', c.kind, right(c.value, 4), c.ids), E'\n' ORDER BY c.kind, c.ids)
  INTO found
  FROM (
    SELECT 'serial' AS kind, "iccid" AS value, string_agg("id", ', ' ORDER BY "createdAt", "id") AS ids
    FROM "OfficeTask"
    WHERE "action" = 'activate' AND "status" = 'working' AND "iccid" IS NOT NULL
    GROUP BY "iccid" HAVING count(*) > 1
    UNION ALL
    SELECT 'number', "msisdn", string_agg("id", ', ' ORDER BY "createdAt", "id")
    FROM "OfficeTask"
    WHERE "action" = 'activate' AND "status" = 'working' AND "msisdn" IS NOT NULL
    GROUP BY "msisdn" HAVING count(*) > 1
  ) c;

  IF found IS NOT NULL THEN
    RAISE EXCEPTION E'Open activation tasks share a SIM serial or a number; nothing was changed.\nReject or cancel all but one task of each group, then run the migration again:\n%', found
      USING ERRCODE = 'unique_violation';
  END IF;

  CREATE UNIQUE INDEX "OfficeTask_open_activation_iccid" ON "OfficeTask"("iccid")
    WHERE "action" = 'activate' AND "status" = 'working' AND "iccid" IS NOT NULL;

  CREATE UNIQUE INDEX "OfficeTask_open_activation_msisdn" ON "OfficeTask"("msisdn")
    WHERE "action" = 'activate' AND "status" = 'working' AND "msisdn" IS NOT NULL;
END
$$;
