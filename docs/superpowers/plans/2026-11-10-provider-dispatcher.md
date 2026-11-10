# Outbox relay, dispatcher and recovery — plan

Spec: `docs/superpowers/specs/2026-11-10-provider-dispatcher.md`. ADR 0018. Paths under `apps/api/`. Local only:
not pushed, not deployed; migrations applied to a throwaway test database only.

- [x] **D.1 Schema.** `ProviderOperation.leaseUntil`, `sentAt`; `OutboxMessage.claimedUntil`; migration
  `20261110180000_dispatch_leases` (additive).
- [x] **D.2 Rules.** `providers/operations/provider-operation.rules.ts`: `SendEvidence`, `outcomeOf`,
  `recoveryOutcome`, `closesUnknown`, `CALL_TIMEOUT_MS`, `ATTEMPT_LEASE_MS`, `OutgoingOperation`. Spec beside it.
- [x] **D.3 Service and store.** `claim` leases; `beginSend`; `settle` takes the provider's late verdict;
  `recover`; `expiredPending`. Repository: `markSent`, `operationToSend`, `expiredPendingIds`, `moveStatus` guard.
- [x] **D.4 Gateway.** `ProviderGateway.send`; `SimulatedProviderGateway.send` answers "never left".
  `providers/testing/scripted-gateway.ts` for specs.
- [x] **D.5 Dispatcher.** `providers/operations/operation-dispatcher.ts` (`OperationDispatcher`, `recoverExpired`).
- [x] **D.6 Relay.** `office/outbox/outbox.repository.ts`, `outbox-relay.ts`, `queue-publisher.ts`.
- [x] **D.7 Worker.** `src/provider-dispatch.ts`, `src/worker.ts`, `src/config.ts` (`PROVIDER_DISPATCH`,
  `providerDispatchOn`), `.env.example`.
- [x] **D.8 Specs.** `operation-dispatcher.db.spec.ts`, `office/outbox/outbox-relay.db.spec.ts` (PostgreSQL, and
  Redis for the queue part), `worker.spec.ts`; `.github/workflows/ci.yml` gives the `db` job a Redis.
- [x] **D.9 Maps.** (slice commit 6fd4ea3) `docs/architecture/backend.md`, ADR 0018 (0017 notes the late verdict).

## Not started (waits for review)

1. A provider status check on the gateway and its use for `unknown`.
2. A branch screen listing unknown operations, with the verdict buttons (`resolveUnknown`).
3. The first real adapter, and `recordIn` inside the activation's transaction (ADR 0017 "Wiring an activation").
4. Pruning published outbox rows; counters for unknown and failed operations.
