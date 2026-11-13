-- ADR 0018 (amendment) and ADR 0019, D18 (final corrections of slice S.12a). One column on "ProviderOperation" and
-- one CHECK; no historical migration is edited and no row is changed.
--
-- `attempts` is the number of the current attempt. It only ever grows: it fences an old attempt's answer from a
-- later attempt, and it is the sequence of the outbox messages, so it is never decremented and never reused.
-- Until now it was also the budget (`MAX_ATTEMPTS`): an attempt that was taken and then handed back because the
-- owner had closed the provider's dispatch (a pause, a replaced credential) was counted, though nothing was sent
-- and no connection was tried. Five such hand-backs would have failed an operation the provider never saw.
--
-- `waivedAttempts` counts the attempts that were handed back before their send mark while the provider's gate was
-- closed. The budget is `attempts - waivedAttempts`. The default is 0, so every existing operation keeps exactly
-- the count it had.
ALTER TABLE "ProviderOperation" ADD COLUMN "waivedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProviderOperation" ADD CONSTRAINT "ProviderOperation_waivedAttempts_bounds" CHECK ("waivedAttempts" >= 0 AND "waivedAttempts" <= "attempts");
