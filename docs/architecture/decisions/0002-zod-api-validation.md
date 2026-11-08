# 0002 — zod for API input validation

Date: 2026-11-08 · Status: accepted (owner)

## Context
`office.dto.ts` is Swagger-only (every field optional). Request bodies are typed `unknown` and parsed by hand inside `office.service.ts`, inconsistently. No `ValidationPipe` exists.

## Decision
Each route declares a zod schema in `<domain>.schemas.ts`. Failures map to the existing `{ message, code }` shape with `400 INVALID`. Business refusals (`NOTE_REQUIRED`, `BALANCE_CEILING`, …) stay in the service.

**Where the check runs.** Today the service resolves the session first (`actor(gate)`), so a request without a session answers `401` before its body is judged. A Nest pipe runs before the handler and would turn that into `400`. Until the actor is resolved by a guard (guards run before pipes), schemas are applied inside the service with `parseInput(schema, body)` (`modules/shared/input.ts`) right after `actor()`. When a domain moves to its own module with an `ActorGuard` (Phase 3), its routes switch to a `ZodPipe`.

Pilot: `FundBody`, `CeilingBody` (`office/wallet.schemas.ts`), pinned by `wallet.schemas.spec.ts` against the old hand-written rules.

## Consequences
- Business rules stay in the service/rules files; shape validation moves to the edge.
- Migration route group by route group (Phase 2.4), behaviour-preserving: same error codes for the same bad inputs.
