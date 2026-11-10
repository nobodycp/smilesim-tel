# A durable life for provider operations — plan

Spec: `docs/superpowers/specs/2026-11-10-provider-operation-lifecycle.md`. ADR 0017. Paths under `apps/api/`.
Local only: not pushed, the migration applied to a throwaway test database only.

- [x] **O.1 Rules.** `src/modules/office/providers/operations/provider-operation.rules.ts` and its spec: states,
  moves, `afterAttempt`, `maySend`, key and request fingerprint.
- [x] **O.2 Schema.** `prisma/schema.prisma` (`ProviderOperation`, `OutboxMessage`, back-relations on `Provider`
  and `Line`); migration `20261110160000_provider_operations`; `prisma migrate diff` empty.
- [x] **O.3 Store and use cases.** `operations/provider-operations.repository.ts`,
  `operations/provider-operations.service.ts` (`record`, `recordIn`, `status`, `claim`, `settle`,
  `resolveUnknown`), registered in `providers/providers.module.ts`.
- [x] **O.4 PostgreSQL spec.** `operations/provider-operations.db.spec.ts` (CI `db` job).
- [x] **O.5 Maps.** `docs/architecture/backend.md`, ADR 0017.

## Next phase (not started; waits for review)

1. **Dispatcher** in the worker: read unpublished `OutboxMessage` rows (`FOR UPDATE SKIP LOCKED`), `claim`, call
   the real `ProviderGateway` with the key, `settle`, stamp `publishedAt`. A `pending` row older than the call
   timeout becomes `unknown`.
2. **Status check** on the gateway port (`check(key)`), feeding `resolveUnknown`; and a branch screen for the
   unknown ones a provider cannot answer.
3. **One operation, activation**, behind the gateway for one provider: see ADR 0017 "Wiring an activation".
