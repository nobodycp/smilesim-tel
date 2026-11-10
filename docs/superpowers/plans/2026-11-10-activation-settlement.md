# Activation through a provider — plan

Spec: `docs/superpowers/specs/2026-11-10-activation-settlement.md` (decisions D1–D19, transactions T1–T11, specs
1–29). ADR 0019. **Not started: S.1 begins after the owner's review of the final design.** Paths under `apps/api/`
unless said. Each slice is one commit, leaves every existing spec green on CI (including the PostgreSQL and Redis
job), and changes nothing a user can see unless it says **Visible**.

Every slice that writes follows the spec's lock order: task → line → advisory keys (serial, number) → operation →
wallets (sorted). A slice's review checks that order in the code it adds.

## Slices

- [x] **S.0 Decisions.** O1–O6 and the final review; spec sections 9 and 10.

- [ ] **S.1 Schema (additive, nothing reads it).**
  `ProviderOperation`: `taskId` (FK, **unique**), `appliedAt`, `applyError`, `applyFailedAt`, `resultMsisdn`,
  `resultIccid`, `resultEsimCode`. `OfficeTask`: `requestKey` (unique), `requestHash`. `Provider`:
  `dispatchApprovedAt`, `dispatchApprovedBy`, `dispatchPausedAt`. New `ProviderDecisionEvent` (unique
  `(operationId, sequence)`; trigger refusing `UPDATE` and `DELETE`) and `ProviderCredential` (provider, target,
  sealed value; unique `(providerId, target)`).
  *Transactions:* none. *Specs:* 5 (the unique `taskId`), 22 (the trigger). `prisma migrate diff` empty.

- [ ] **S.2 Reservation in the database (O1). Visible.**
  A migration that lists open activation tasks sharing a serial or a number and stops if any exist, then the two
  partial unique indexes. `TasksService.openTask` for activations: advisory keys, live-line check, the task
  inserted `ON CONFLICT DO NOTHING` **before** the hold; line creation (`lines.service.ts`, `task-completion.ts`)
  checks open activation tasks under the same keys.
  *Transactions:* T1 (without the operation), T8. *Locks:* keys → task insert → wallet.
  *Visible:* a second manual task for the same card is refused when opened. *Specs:* 1–3.

- [ ] **S.3 Rules (pure).**
  `src/modules/office/lines/activation-settlement.rules.ts`: `operationKey(taskId)`, `taskActions(operation)` (the
  table of D6), `settlementOf(operation)`, `decisionStep(events, actor, decision)` (who may propose, who may
  approve, never one's own). `provider-operation.rules.ts`: `confirmed` evidence carries the result fields.
  *Transactions:* none. *Specs:* unit specs covering every row of D6 and every rule of D15.

- [ ] **S.4 Ledger `capture` (O2). Visible.**
  `wallets/wallet-ledger.ts` `capture`; manual completion uses it in place of release-then-debit.
  *Transactions:* T8. *Locks:* unchanged (task → line → keys → wallet).
  *Visible:* a ceiling lowered after a task opened no longer blocks its completion. *Specs:* 17, 18, and the
  existing wallet and line concurrency specs.

- [ ] **S.5 eSIM data (D17). Visible.**
  Sealing in the repositories for `Line.esimQr`, `OfficeTask.esimQr` and `ProviderOperation.resultEsimCode`;
  `seal-secrets` extended to the existing rows; the code leaves the line and task **lists**; the detail returns it
  to the entitled accounts and records `line.esim_read`. `response-shape.spec.ts`, `routes.http.spec.ts`.
  *Transactions:* none new. *Visible:* the line list no longer carries the eSIM code (a web follow-up in S.10 if a
  screen reads it from the list). *Specs:* 23.

- [ ] **S.6 Request key (O4): API, then web.**
  API: `Idempotency-Key` honoured by `POST /office/lines` when it opens a task (`requestKey`, `requestHash`, the
  replayed answer). Web (its own web spec first): the activation form creates and sends the key.
  *Transactions:* T1. *Specs:* 4 (without "required").

- [ ] **S.7 Guards on the manual path, and cancel (D6, D7).**
  Completion and reject lock and read the task's operation and go on only with none or `failed`. Cancel gains the
  atomic `requested → failed (abandoned)` + release, and refuses on `pending`, `unknown`, succeeded-not-applied
  and an exception. All three ask `taskActions`. No task has an operation yet, so nothing changes for users; the
  specs build operations by hand.
  *Transactions:* T8, T9. *Locks:* task → line → keys → operation → wallet. *Specs:* 8–10, 14–16.

- [ ] **S.8 Settlement.**
  `lines/activation-settlement.ts` (`apply`, `applyPending`, the exception write), reusing the activation handler
  of `TaskCompletion` through one shared function; `settle` writes the `provider-operation.settled` message and
  the result fields; `provider-dispatch.ts` gains the topic, its handler and the sweeper timer.
  *Transactions:* T4 (one more message), T5, T5′, T6, T7. *Locks:* T5 task → keys → operation → wallet.
  *Specs:* 6, 7, 11–13, 24, 27, 29.

- [ ] **S.9 Decisions (O5).**
  `lines/provider-decisions.ts`; policy rows; `POST /office/tasks/:id/provider-decision` (propose or decide) and
  `POST /office/tasks/:id/provider-decision/approval` (approve or refuse); zod, activity, `refuseEntered`;
  `permissions.http.spec.ts`, `routes.http.spec.ts`, `response-shape.spec.ts`; error copy in ar / en / he.
  *Transactions:* T10, T11. *Locks:* task → keys → operation → wallet. *Specs:* 19–22.

- [ ] **S.10 The screens (O6). Visible.**
  A web spec first: the waiting label, the exception state, the decision form with its evidence fields, the
  approval queue for the second account, the eSIM code on the detail only. Checked at every width, ar + en, light
  and dark.

- [ ] **S.11 Opening.**
  `ProviderGateway.dispatches(providerCode)`; `LinesService.route()` answers `dispatch`; `activate` opens the task
  and records the operation in one transaction; the request key is required on this route.
  `dispatches` is false everywhere (S.12a has not landed), so no sale takes the route.
  *Transactions:* T1 complete. *Specs:* 1 (with the operation), 4 ("required"), 28.

- [ ] **S.12 Switching on, in two parts with a review between them.**
  - **S.12a The switch (D18), no adapter.** `worker.ts` runs the production settings check with the worker's list;
    `PROVIDER_ADAPTERS`, `PROVIDER_TARGET`; `providerDispatchOn()` replaced by the four conditions; the owner's
    approve / pause / credential routes (write-only, sealed, audited); the routing gateway in the worker with an
    empty adapter list. ADR 0016, ADR 0018 and the production-config plan corrected (spec section 10, items 1–3).
    *Specs:* 25, 26.
  - **S.12b The first adapter**, its own spec and review: one provider, the sandbox target, endpoints as constants,
    error mapping to `OPERATION_ERRORS`, the status check feeding `resolveUnknown`. Exercised on a staging
    deployment that is production-grade (`NODE_ENV=production`, `PROVIDER_TARGET=sandbox`, its own database, Redis
    and sandbox credentials).

## Go-live gate: nothing is dispatched to a live provider until all of these are true

1. S.1–S.12a merged and green on CI; S.12b reviewed and green.
2. The web sends the request key and the dispatch route requires it (S.6, S.11) — **O4**.
3. The waiting label, the exception view, the decision form and the approval queue are live (S.9, S.10) — **O5,
   O6**; at least **two** authorised accounts exist on the branch.
4. The reservation indexes exist on the target database and the migration's conflict report was empty (S.2).
5. eSIM codes are sealed on the target database (`seal-secrets` run) and `SECRETS_KEY` is set on the API and the
   worker (S.5).
6. The staging run on the sandbox target passed its checklist: success, refusal, timeout → unknown → decision,
   exception, cancel while requested, pause.
7. A written procedure for the branch: an unknown operation, an exception, a provider failure, a pause.
8. On the production deployment, by name and in this order: `PROVIDER_ADAPTERS`, `PROVIDER_TARGET=live`, the live
   credential, `PROVIDER_DISPATCH=1`, then the owner's approval of the provider. Staging having passed sets none of
   them.

## Order and safety

S.1, S.3, S.6 (API), S.7, S.8, S.9, S.11 change nothing visible. S.2, S.4, S.5 change the manual path as decided
and are each reviewed on their own. S.11 can route a sale to the dispatcher only where `dispatches(code)` is true,
which needs S.12a's four conditions, set by hand per deployment. Going back from any slice: revert its commit;
S.1's columns and S.2's indexes can stay.
