-- An open activation task reserves its SIM serial and its number (ADR 0019, D5; plan slice S.2): the database
-- refuses a second open activation task for the same serial or the same number. The reservation ends when the
-- task leaves 'working' (done, rejected, cancelled): no row is deleted for that.
--
-- If open activation tasks already share a serial or a number, this migration stops before it changes anything
-- and names them. It never closes, changes or deletes a task: the branch rejects or the submitter cancels all but
-- one of each group, then the migration is run again. `npm run reservation-conflicts --workspace api` lists the
-- same groups without changing anything, and is meant to be run before a deploy.

DO $$
DECLARE
  found text;
BEGIN
  SELECT string_agg(format('  %s %s: tasks %s', c.kind, c.value, c.ids), E'\n' ORDER BY c.kind, c.value)
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
END
$$;

CREATE UNIQUE INDEX "OfficeTask_open_activation_iccid" ON "OfficeTask"("iccid")
  WHERE "action" = 'activate' AND "status" = 'working' AND "iccid" IS NOT NULL;

CREATE UNIQUE INDEX "OfficeTask_open_activation_msisdn" ON "OfficeTask"("msisdn")
  WHERE "action" = 'activate' AND "status" = 'working' AND "msisdn" IS NOT NULL;
