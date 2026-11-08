# Office domain split — spec

Date: 2026-11-08 · Parent plan: `docs/superpowers/plans/2026-11-08-architecture-refactor.md` (Phase 3)

## Goal

Split `apps/api/src/modules/office/office.service.ts` (~3,950 lines, ~70 public methods, ~55 shared helpers) and `office.controller.ts` (78 routes) into one service + controller per domain, without changing any endpoint path, response shape, error code, error precedence, or activity-log entry.

## Decisions

1. **Strangler, not big bang.** One domain per slice. `OfficeService` stays as a facade whose moved methods delegate to the domain service, so the ~300 existing spec calls (`service.x(gate, …)`) keep guarding behaviour unchanged. The facade and its delegations are deleted in the last slice, when specs move to the domain services.
2. **Layout inside the office module.** `modules/office/kernel/` and `modules/office/<domain>/{<domain>.controller.ts, <domain>.service.ts, <domain>.schemas.ts}`. One Nest `OfficeModule` keeps every provider, so there are no cross-module cycles. Pure rule files (`office-rules.ts`, `transfer-rules.ts`, …) stay where they are and are imported.
3. **`OfficeKernel`** (`kernel/office-kernel.ts`) holds what every domain needs: the Prisma client (with the spec override `prismaClient`), the auth store, the notice writer, and the shared helpers `actor`, `grantsFor`, `accounts`, `visibleAccount`, `visibleLine`, `branchActor`, `runTx`, `queueNotices`, `publishQuietly`, `actorName`, `move`, `recordOp`. `OfficeService` keeps private one-line delegators, so its remaining methods do not change.
4. **Actor resolution is an interceptor, not a guard.** Guards run before interceptors, so a guard's `401` would bypass `ActivityInterceptor` and stop logging refused attempts on logged routes. Domain controllers declare `@UseInterceptors(ActivityInterceptor, ActorInterceptor)`: the activity interceptor wraps the actor interceptor, which resolves `kernel.actor(gateOf(req))` and stores it on the request; `@Actor()` reads it. Domain service methods take `Actor`, not `Gate`.
5. **`ZodPipe`** for domain routes (`@Body(new ZodPipe(Schema))`). Pipes run after interceptors, so `401` still precedes `400 INVALID`, and a pipe refusal still reaches `ActivityInterceptor` as a logged `fail`.
6. **Grant checks stay inline** in the moved methods for now. `@RequireGrant` comes only when a slice can prove the same refusal order.

## Non-goals

- No behaviour change, no new endpoint, no schema migration (indexes are their own slice, 3.last).
- No rewrite of method bodies beyond `this.x` → `this.kernel.x` and `gate` → `actor`.

## Slice order

3.0 kernel + interceptor + pipe · 3.1 notices · 3.2 audit · 3.3 tasks · 3.4 wallets/finance/ledger/reports · 3.5 providers + companies · 3.6 packages + prices + user packages · 3.7 users + roles · 3.8 transfers · 3.9 lines · 3.10 catalog seed out of `onModuleInit` · 3.11 specs move off the facade, facade deleted · 3.last indexes + subtree queries.

## Done means (each slice)

`npm run lint && npm run typecheck && npm run test:api && npm run build` green with **no spec edited** (except 3.11); the moved routes keep their `@Activity`; `docs/architecture/backend.md` lists the new files; the plan box is ticked with the commit hash.
