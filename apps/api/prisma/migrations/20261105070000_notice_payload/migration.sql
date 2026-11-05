-- A notice carries a kind and a payload the browser turns into text. The old action/msisdn/refId
-- columns fold into the payload, and the link points at the record itself.
ALTER TABLE "Notice" ADD COLUMN "payload" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Notice" ADD COLUMN "actorId" TEXT;
ALTER TABLE "Notice" ADD COLUMN "actorName" TEXT NOT NULL DEFAULT '';

UPDATE "Notice"
SET "payload" = jsonb_build_object('action', "action", 'msisdn', "msisdn", 'taskId', "refId"),
    "href" = '/tasks/' || "refId",
    "kind" = CASE "kind" WHEN 'task' THEN 'task.opened' WHEN 'task_reply' THEN 'task.done' ELSE "kind" END;

ALTER TABLE "Notice" DROP COLUMN "action";
ALTER TABLE "Notice" DROP COLUMN "msisdn";
ALTER TABLE "Notice" DROP COLUMN "refId";

CREATE INDEX "Notice_userId_readAt_idx" ON "Notice"("userId", "readAt");
