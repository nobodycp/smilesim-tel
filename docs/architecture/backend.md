# Backend codemap — `apps/api`

Living map of the API. Read this instead of re-reading `src/`. **Update it in the same commit** whenever a module, endpoint group, model, or responsibility changes (see `CLAUDE.md` → "Keep the maps current").

Last verified: 2026-11-08 (commit `75cbcaf`). tsc clean, lint clean, jest 428/429 (one timeout in `esim-ops.spec.ts:280`).

## Stack

NestJS 12 · Prisma 7 (`@prisma/adapter-pg`, PostgreSQL) · BullMQ + ioredis · argon2 · otplib (TOTP) · Swagger at `/docs` (non-production only) · Jest 30 + ts-jest 29 + supertest.

## Entry points

| File | Role |
|---|---|
| `src/main.ts` | bootstrap: body limit 1mb, CORS (`cors.ts`), OpenAPI (`openapi/`). No global ValidationPipe, guard, or exception filter. |
| `src/app.module.ts` | imports `featureModules` from `modules/registry.ts` + `HealthController` + `DoorMiddleware` |
| `src/door.middleware.ts`, `src/doors.ts` | resolves the door (layer) from the `x-door` header |
| `src/worker.ts` | BullMQ worker, no processors yet; daily `activityEvent` purge via `setInterval` |
| `src/errors.ts` | `ERROR_MESSAGES` catalog (code → message), tested |
| `src/db.ts` | `createPrismaClient()` |
| `src/generated/` | Prisma client output — generated, never edit, git-ignored |

## Modules

| Module | Files | Owns |
|---|---|---|
| `auth/` | controller, service, `auth.store.ts` (in-memory), `prisma-auth.store.ts`, `decide-login`, `password`, `totp`, `sessions`, `validators`, `trial-seed`, `cities` | login, sessions (cookie `sid`, max sessions), 2FA, password change, trial accounts. Store behind `AUTH_STORE` token. |
| `branding/` | controller, service, store (memory + prisma), rules | site identity (logo, title, icon). Small and clean — the reference shape for other modules. |
| `office/` | `office.controller.ts` (~1150 lines), `office.service.ts` (~4000 lines), many pure rule files | **everything else** — see below. The god module to be split. |
| `activity` (in `office/activity.module.ts`) | `activity-recorder.ts`, `activity-log.ts` | audit/activity events |

### `office` endpoint groups (controller line ≈ decorator)

- identity/home: `me` 98, `home` 105, `announcements` 112
- wallets/finance: `wallets` 120, `fund` 127, `ceiling` 141, `finance` 1074, `ledger/:scope` 1103, `reports/:kind` 1125
- packages: 155–321 (list, sheet, chain, renewals, switches, mode, sell-prices), custom-prices 219–247, line-prices 265/279
- companies: 162, image 329, sim 337
- providers: 351–380, provider-operations 1045
- lines: 394–605 (list, detail, create, charge, refresh, disconnect, freeze/unfreeze, extend, reactivate, rename, esim, sim, transfer, switch). `company-switch` 441 is a stub that always returns 400.
- notices: list 619, SSE stream 635, read 668
- tasks: 677–777 (list, detail, notes, take, release, complete, reject, cancel)
- users/tree: 785–1000 (list, directory, detail, user packages, ops, access, create, transfer, transfer-preview, password, freeze/restore/delete, enter/leave)
- roles 885/892 · audit 1013

### Pure rule files in `office/` (well tested, keep pure)

`office-rules.ts` (line ops), `transfer-rules.ts`, `user-terms.ts`, `line-prices.ts`, `office-grants.ts`, `task-access.ts`, `task-log.ts`, `office-paging.ts` (cursor paging), `office-terms.ts`, `notice-kinds.ts`, `office-catalog.ts`, `office-esim.ts`.

## Cross-cutting patterns (current)

- **Auth/authorization:** no guard. Every service method calls `await this.actor(gate)` (≈57 sites, `office.service.ts:~3157`), then checks inline (`actor.isBranchOwner`, `actor.grants.includes('edit')`, layer comparisons, `visibleAccountIds`).
- **Errors:** `fail(status, code)` throws `OfficeFailure`; the controller's private `run()` (`office.controller.ts:~1139`) maps it to `{ message, code }` and records the activity event. Not a Nest exception filter.
- **Validation:** `office.dto.ts` is Swagger-only (all optional). Bodies are `unknown` and parsed by hand in the service.
- **Persistence:** the service builds its own Prisma client (not injected). `runTx` = `$transaction` at Read Committed.
- **Money:** Int agorot. `move()` (`office.service.ts:~3715`) reads the wallet, then writes an absolute balance — **lost-update race**, ceiling check races too.
- **Visibility:** `accounts()` (`~3457`) loads all users and then filters in memory.
- **Seeding:** `ensureCatalog` runs in `onModuleInit` on every start.

## Data model (`prisma/schema.prisma`, 28 migrations)

User, Session, Role, UserRole, LayerPolicy, Wallet, WalletEntry, Provider, Company, Package, PackageRenewal, PackageSwitch, UserPackage, SellPrice, Line, OfficeTask, OfficeTaskNote, ActivityEvent, AccessLog, Notice, Announcement, SiteBranding.
Status/kind/layer fields are `String` (no enums). Missing indexes: `Line.status/packageId/iccid`, `User.parentId`, `OfficeTask.assigneeId`, `WalletEntry.kind`.

## Tests

37 suites. Pure rule specs + service specs on an in-memory fixture (`tree-fixture.ts`) + supertest HTTP specs for auth and branding. Gaps: no office HTTP permission matrix, no wallet concurrency test, no coverage gate.

## Target shape (refactor plan)

See `docs/superpowers/plans/2026-11-08-architecture-refactor.md`. Short form: `modules/shared` (PrismaService, ActorGuard + `@Actor()`, `@RequireGrant`, global exception filter, activity interceptor, paging, money, validation) plus one module per domain — `wallets`, `lines`, `packages`, `providers`, `companies`, `tasks`, `users`, `transfers`, `notices`, `audit`, `catalog-seed` — each with `controller / service / repository / dto / rules / spec`. Endpoint paths and response shapes stay identical (`response-shape.spec.ts` guards them).
