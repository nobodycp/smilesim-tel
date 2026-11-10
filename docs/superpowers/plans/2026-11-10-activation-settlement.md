# Activation through a provider — plan

Spec: `docs/superpowers/specs/2026-11-10-activation-settlement.md`. ADR 0019. **Not started: every slice waits for
the owner's review of the design and of O1–O6.** Paths under `apps/api/`. Each slice is one commit, leaves every
existing spec green, and changes nothing a user can see until S.6 is switched on for a provider.

- [ ] **S.0 Decisions.** The owner answers O1–O6; the spec is updated.
- [ ] **S.1 Schema (additive).** `ProviderOperation.taskId` (FK, indexed), `appliedAt`, `resultMsisdn`,
  `resultIccid`, `resultEsimCode`. Migration; `prisma migrate diff` empty. Nothing reads them.
- [ ] **S.2 Rules.** `src/modules/office/lines/activation-settlement.rules.ts` (pure): `operationKey(taskId, n)`,
  `inFlight(status, appliedAt)`, `taskMayBe{Completed,Rejected,Cancelled}(operation)`, `settlementOf(status)`.
  Spec beside it. `provider-operation.rules.ts`: `SendEvidence.confirmed` carries the result fields.
- [ ] **S.3 Ledger.** `wallets/wallet-ledger.ts` `capture(tx, userId, held, amount, kind, sale)`; spec on
  PostgreSQL (lowered ceiling, concurrent debits, `held` never negative). Architecture guard `wallet-writes`
  unchanged (the ledger is still the only writer).
- [ ] **S.4 Guards on the manual path.** `lines/task-completion.ts`, `tasks/tasks.service.ts` (reject, cancel):
  lock and read the task's operation; refuse unless none or `failed`. No task has an operation yet, so behaviour
  is unchanged; specs build one by hand. With O1: the reservation in `openTask` for activations.
- [ ] **S.5 Settlement.** `lines/activation-settlement.ts` (`apply(operationId)`, `applyPending()`), reusing
  `TaskCompletion`'s activation handler through a shared function; `settle` writes the
  `provider-operation.settled` message; `provider-dispatch.ts` gains the topic, the queue handler and the sweeper
  timer. Specs 4–9, 12–16 of the spec's list.
- [ ] **S.6 Opening.** `ProviderGateway.dispatches(providerCode)` (false in the simulated gateway);
  `LinesService.route()` answers `dispatch`; `activate` opens the task and records the operation in one
  transaction (`openTask` takes a step to run inside its transaction). Specs 1–3, 10, 11.
- [ ] **S.7 The branch's verdict.** Route `POST /office/tasks/:id/provider-verdict` (policy row, activity, zod),
  and the screen (web spec first: label, verdict buttons). Needs O5, O6.
- [ ] **S.8 First adapter**, on staging only (`NODE_ENV=staging`, `PROVIDER_DISPATCH=1`), one provider, one
  package. Its own spec: credentials through `SECRETS_KEY`, error mapping to `OPERATION_ERRORS`, the status check.

## Order and safety

S.1–S.5 can land one by one with nothing switched on: no task has an operation, the gateway dispatches for no
provider, the dispatcher is off. S.6 is the first slice that can change a sale, and only where
`dispatches(code)` is true. Production stays as it is until S.8 is approved.

Going back from any slice: revert its commit; S.1's columns can stay empty.
