-- An account is named `…LoginName` everywhere on the wire (ADR 0014). Transfer notices stored the other account
-- under `toLogin` / `fromLogin`; the keys are renamed in place so notices written before this read the same.
UPDATE "Notice"
SET "payload" = ("payload" - 'toLogin') || jsonb_build_object('toLoginName', "payload" -> 'toLogin')
WHERE "payload" ? 'toLogin';

UPDATE "Notice"
SET "payload" = ("payload" - 'fromLogin') || jsonb_build_object('fromLoginName', "payload" -> 'fromLogin')
WHERE "payload" ? 'fromLogin';
