# Backend hardening — spec

Source: `docs/reviews/2026-11-10-backend-review.md` (finding ids M*, S*, A* below). Owner 2026-11-10: fix all of it
in the review's order, after strict rules exist so the same defects cannot return. Backend only; the web app is not
touched and must keep working against the API as it is.

## Goal

The API is safe to run with real money and readable enough to hand to a team: line state cannot be double-refunded
or double-charged, permissions hold, the contract is uniform, the provider's answer comes from the server, and the
code is split by domain with no dead code.

## Decisions

1. **Rules first.** `.cursor/rules/backend-engineering.mdc`, enforced by `apps/api/src/architecture.spec.ts`
   (ratchet baseline) and ESLint size limits. Every later phase lowers a baseline.
2. **Line lock.** Every transaction that changes a line starts with `lockLine(tx, id)` (`SELECT … FOR UPDATE`),
   re-reads the line and validates its status for the action. Order: line, then wallets (sorted by id).
3. **One open task per line and action** (add-ons excepted: two different add-ons are two requests). `openTask`
   locks the line and refuses a second with `409 DUPLICATE_REQUEST`. No partial unique index: Prisma cannot
   describe one, so it would show as drift; the line lock makes the check race-free.
4. **A task stores its unit price** (`OfficeTask.unitPrice`) when it opens; completion charges and records it.
5. **A live ICCID is unique**: `SIM_TAKEN` (409), checked under a transaction-level advisory lock on the serial
   (same reason as 3 for not using a partial index).
6. **Freezing a staff account** returns its tasks to the pool: `assigneeId: null`, status stays `working`.
   Existing `pending` rows are migrated to `working`.
7. **Entering**: only an account below the branch layer can be entered. An entered session cannot use `/auth`
   writes. The operator is stored on the impersonation session row.
8. **Prices by layer**: `GET /office/packages` returns `branchCost`, the ladder columns above the viewer,
   `providerCode` and run modes to the branch only. Lower layers get `null` / empty for them (same keys, so the web
   types hold).
9. **Password reset** (`POST /office/users/:login/password`): owner, or branch staff with `staff`; a staff target
   is owner-only; lower layers keep their rule (a direct subtree, lower rank). Every reset drops the target's
   sessions.
10. **Errors**: one global filter; every error is `{ message, code }`. Conflicts are 409. A body-less write is `{}`.
11. **Validation**: every body goes through a zod schema. Messages and codes stay what they are today
    (`INVALID` unless the service has a specific code).
12. **Provider gateway**: `ProviderGateway` port with `SimulatedProviderGateway`. The simulated gateway is the only
    reader of the request's `outcome`. It stays on by default so staging keeps working, warns at boot when it
    runs in production, and `PROVIDER_SIMULATION=0` switches it off (every operation then goes to a branch task).
    The web keeps sending `outcome` until real providers exist; the field is documented as simulation-only.
    Before real sales: connect a real gateway or set `PROVIDER_SIMULATION=0`.
13. **Structure**: kernel split into focused services behind the same `OfficeKernel` surface first, then callers
    move; rule files move into their domains; test helpers move to `testing/`; dead code is deleted.
14. **No path or response-shape change** except the ones named here (8, 10). `routes.http.spec.ts` and
    `response-shape.spec.ts` stay green.

## Non-goals

- Renaming routes or a `/v2` (review A8): needs the web app; listed as a later spec.
- Real provider adapters, SMS/email gateways.
- Web changes of any kind.

## Risks

- The full `test:api` suite runs only on GitHub Actions and nothing is pushed until the owner asks: each slice runs
  its own spec files locally, and the first push must be watched.
- Migrations add constraints; data that already violates them (duplicate live ICCID, two open tasks) makes the
  migration fail. Each migration first repairs or reports such rows.
