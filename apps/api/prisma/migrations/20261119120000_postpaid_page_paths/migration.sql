-- The postpaid line's pages moved under `/postpaid/…` (spec 2026-11-19-business-lines-foundation, F.7a and F.7c):
-- numbers, packages, companies, providers, provider accounts and provider operations. A notice stores the page it
-- opens (`Notice.href`, built by `notifications/notice-kinds.ts`) and an offer its button's page (`Offer.actionHref`);
-- a stored path that starts with a moved page gains the `/postpaid` prefix, its rest (record, query, fragment) kept.
-- The old addresses keep no alias (the owner's standing rule), so an unrewritten path would open a 404.
--
-- Idempotent: a rewritten path starts with `/postpaid/` and no longer matches. Data only, no lock beyond the rows.
UPDATE "Notice"
SET "href" = '/postpaid' || "href"
WHERE "href" ~ '^/(numbers|packages|companies|providers|provider-accounts|provider-operations)([/?#]|$)';

UPDATE "Offer"
SET "actionHref" = '/postpaid' || "actionHref"
WHERE "actionHref" ~ '^/(numbers|packages|companies|providers|provider-accounts|provider-operations)([/?#]|$)';
