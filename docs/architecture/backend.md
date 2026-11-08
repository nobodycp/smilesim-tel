# Backend codemap — `apps/api`

Living map of the API. Read this instead of re-reading `src/`. **Update it in the same commit** whenever a module, endpoint group, model, or responsibility changes (see `CLAUDE.md` → "Keep the maps current").

Last verified: 2026-11-08 (branch `refactor/phase-1`, after Phase 2). tsc clean, lint clean, jest 460/460 (+2 DB tests, run in the CI `db` job).

## Stack

NestJS 12 · Prisma 7 (`@prisma/adapter-pg`, PostgreSQL) · BullMQ + ioredis · argon2 · otplib (TOTP) · Swagger at `/docs` (non-production only) · Jest 30 + ts-jest 29 + supertest.

## Entry points

| File | Role |
|---|---|
| `src/main.ts` | bootstrap: body limit 1mb, CORS (`cors.ts`), OpenAPI (`openapi/`). No global pipe or guard; office errors go through `OfficeFailureFilter` on the controller. |
| `src/app.module.ts` | imports `featureModules` from `modules/registry.ts` + `HealthController` + `DoorMiddleware` |
| `src/door.middleware.ts`, `src/doors.ts` | resolves the door (layer) from the `x-door` header |
| `src/worker.ts` | BullMQ worker, no processors yet; daily `activityEvent` purge via `setInterval` |
| `src/errors.ts` | `ERROR_MESSAGES` catalog (code → message), tested |
| `src/db.ts` | `createPrismaClient()` — called by `PrismaService` (and the worker); specs that build services by hand fall back to it |
| `src/generated/` | Prisma client output — generated, never edit, git-ignored |
| `modules/shared/` | `prisma.service.ts` (global `PrismaModule`, one client per process), `office-failure.ts` (`OfficeFailure`, `fail()`), `office-failure.filter.ts`, `input.ts` (`parseInput(schema, body)` → 400 INVALID) |

## Modules

| Module | Files | Owns |
|---|---|---|
| `auth/` | controller, service, `auth.store.ts` (in-memory, specs), `prisma-auth.store.ts` (Postgres + Redis: live session keys and the failed-login counter `login-fail:<login>`), `decide-login`, `password`, `totp`, `sessions`, `validators`, `trial-seed`, `cities` | login, sessions (cookie `sid`, max sessions), 2FA, password change, trial accounts. Store behind `AUTH_STORE` token. |
| `branding/` | controller, service, store (memory + prisma), rules | site identity (logo, title, icon). Small and clean — the reference shape for other modules. |
| `office/` | `office.controller.ts` (~280 lines, routes not yet moved), `office.service.ts` (~1690 lines: methods not yet moved + one-line facades), `office.module.ts` (`OFFICE_CONTROLLERS`, `OFFICE_PROVIDERS`), `gate.ts`, pure rule files | being split per domain (Phase 3, spec `docs/superpowers/specs/2026-11-08-office-domain-split.md`) |
| `office/kernel/` | `office-kernel.ts` (`OfficeKernel`: prisma + spec override `prismaClient`, auth, notice writer, `actor`, `grantsFor`, `accounts`, `visibleAccount`, `branchActor`, `chainIds`, `runTx`, `queueNotices`, `publishQuietly`, `actorName`, `move`, `recordOp`, `pathOf`, `termsFor`, `ladderRows`, `stampWith`, `ensureLayerRoles`, `visibleLine`; `nodeOf`, `PRICE_COLUMNS`), `types.ts` (`Gate`, `Actor`, `Account`, `Sale`), `actor.interceptor.ts` (`ActorInterceptor`, `@Actor()`), `feed.ts` (`feedPosition`), `line-terms.ts` (`lineTermsOf`), `sale.ts` (`saleOf`), `query.ts` (`text`), `office-test-app.ts` (HTTP spec app), `values.ts` (`nonNegative`, `optionalPrice`, `LAYER_ORDER`), `assertBranch()` | what every office domain shares. `routes.http.spec.ts` pins all 79 routes (method, path, activity event, anonymous answer). |
| `office/notices/` | `notice-inbox.service.ts` (`NoticeInboxService`: list, read, subscribe), `notices.controller.ts` | `GET /office/notices`, `GET /office/notices/stream` (SSE), `POST /office/notices/read` |
| `office/audit/` | `audit.service.ts` (`AuditService.list`), `audit.controller.ts` | `GET /office/audit` |
| `office/tasks/` | `tasks.service.ts` (`TasksService`: list, detail, addNote, take, release, reject, cancel; `openTask`, `taskNotice`, `noteLog` used by line ops), `tasks.controller.ts` | `GET /office/tasks`, `GET tasks/:id`, `POST tasks/:id/{notes,take,release,reject,cancel}`. `complete` is still in OfficeController/OfficeService (moves with lines). |
| `office/wallets/` | `wallets.service.ts` (`WalletsService`: list, fund, setCeiling, ledger, finance, providerOperations), `wallets.controller.ts`, `provider-cost.ts` (`pricedOp`, `PROVIDER_OPERATION_KINDS`) | `GET /office/wallets`, `POST wallets/:login/fund`, `PATCH wallets/:login/ceiling`, `GET ledger/:scope`, `GET finance`, `GET provider-operations` |
| `office/providers/` | `providers.service.ts` (`ProvidersService`: list, settings, setEsimPrice, setMode), `providers.controller.ts` | `GET /office/providers`, `GET/PATCH providers/:code/settings`, `PATCH providers/:code/esim-price` |
| `office/companies/` | `companies.service.ts` (`CompaniesService`: shelf, setSim, setImage), `companies.controller.ts` | `GET /office/companies`, `PUT companies/:code/sim`, `POST companies/image` |
| `office/packages/` | `packages.service.ts` (`PackagesService`: list, setSellPrice, clearSellPrice, setMode, sheet, setChain, setTargets), `packages.controller.ts` | `GET /office/packages`, `PUT/DELETE packages/:code/sell-price`, `PATCH packages/:code/mode`, `GET packages/:code/sheet`, `PUT packages/:code/{chain,renewals,switches}` |
| `office/terms/` | `terms.service.ts` (`TermsService`: userPackages, setUserPackage, setUserPackagesBulk, userOps, setUserOps, customPrices, setCustomPrice, clearCustomPrice, linePrices, setLinePrices, repriceLines), `terms.controller.ts` | `GET/PUT users/:login/packages[/:code]`, `GET/PUT users/:login/ops`, `GET/PUT/DELETE packages/:code/custom-prices[/:login]`, `GET/PUT packages/:code/line-prices` |
| `office/accounts/` | `accounts.service.ts` (`AccountsService`: list, directory, create, setPassword, detail, saveAccess, setFrozen, remove, enter), `accounts.controller.ts`; `account-session.{service,controller}.ts` (`leave`, deliberately without ActorInterceptor) | `GET /office/users`, `GET directory`, `POST users`, `POST users/:login/{password,freeze,restore,enter}`, `GET users/:login`, `PATCH users/:login/access`, `DELETE users/:login`, `POST leave` |
| `office/roles/` | `roles.service.ts` (`RolesService`: list, save), `roles.controller.ts` | `GET/POST /office/roles` |
| `office/desk/` | `desk.service.ts` (`DeskService`: me, home, postAnnouncement), `desk.controller.ts` | `GET /office/me`, `GET home`, `POST announcements` |
| `office/transfers/` | `transfers.service.ts` (`TransfersService`: transferAccount, transferPreview, transferLine; uses `TermsService.repriceLines`), `transfers.controller.ts` | `POST users/:login/transfer`, `GET users/:login/transfer-preview`, `POST lines/:id/transfer` |
| `activity` (in `office/activity.module.ts`) | `activity-recorder.ts`, `activity-log.ts` | audit/activity events |

### `office` endpoint groups (in `office.controller.ts`; line numbers are pre-split and drift)

- reports: `reports/:kind` (cross-domain; moves with lines)
- lines: 394–605 (list, detail, create, charge, refresh, disconnect, freeze/unfreeze, extend, reactivate, rename, esim, sim, transfer, switch). `company-switch` 441 is a stub that always returns 400.
- tasks: `complete` only (the rest moved to `office/tasks/`)

### Pure rule files in `office/` (well tested, keep pure)

`office-rules.ts` (line ops), `transfer-rules.ts`, `user-terms.ts`, `line-prices.ts`, `office-grants.ts`, `task-access.ts`, `task-log.ts`, `office-paging.ts` (cursor paging), `office-terms.ts`, `notice-kinds.ts`, `office-catalog.ts`, `office-esim.ts`.

## Cross-cutting patterns (current)

- **Auth/authorization:** moved domains: `ActorInterceptor` resolves the actor before the handler (declared after `ActivityInterceptor`, so refused sessions are still logged; pipes run after it, so 401 precedes 400) and services take `Actor`. Not-yet-moved methods call `await this.actor(gate)` (kernel), then check inline (`actor.isBranchOwner`, `actor.grants.includes('edit')`, layer comparisons, `visibleAccountIds`).
- **Errors:** `fail(status, code)` throws `OfficeFailure` (`shared/office-failure.ts`); `OfficeFailureFilter` (on `OfficeController`) answers `{ message, code }` with its status. Anything else is Nest's 500.
- **Activity log:** routes declare `@Activity(action, subjectKind, subject)` (`office/activity.decorator.ts`; subject = `param('id')`, `bodyField('msisdn')`, or a function). `ActivityInterceptor` records `ok` after the answer or `fail` + code on an `OfficeFailure`.
- **Validation:** `office.dto.ts` is Swagger-only. New/migrated routes use zod schemas (`<domain>.schemas.ts`) through `parseInput()` right after `actor()` (ADR 0002); pilot: `wallet.schemas.ts`. The rest still parse by hand.
- **Persistence:** `PrismaService` is injected (optional) into OfficeService, ActivityRecorder, PrismaAuthStore, PrismaBrandingStore. `runTx` = `$transaction` at Read Committed.
- **Money:** Int agorot. `move()` (`office.service.ts:~3715`) locks the wallet row (`SELECT … FOR UPDATE`) before reading it, so the ceiling check and the absolute write are serialised per wallet (ADR 0004). Proof: `wallet-concurrency.db.spec.ts` (opt-in, `TEST_DATABASE_URL`).
- **Visibility:** `accounts()` (`~3457`) loads all users and then filters in memory.
- **Seeding:** `ensureCatalog` runs in `onModuleInit` on every start.

## Data model (`prisma/schema.prisma`, 28 migrations)

User, Session, Role, UserRole, LayerPolicy, Wallet, WalletEntry, Provider, Company, Package, PackageRenewal, PackageSwitch, UserPackage, SellPrice, Line, OfficeTask, OfficeTaskNote, ActivityEvent, AccessLog, Notice, Announcement, SiteBranding.
Status/kind/layer fields are `String` (no enums). Missing indexes: `Line.status/packageId/iccid`, `User.parentId`, `OfficeTask.assigneeId`, `WalletEntry.kind`.

## Tests

41 suites (one opt-in DB spec). Spec passwords hashed once per file via `office/test-hash.ts`. Pure rule specs + service specs on an in-memory fixture (`tree-fixture.ts`) + supertest HTTP specs for auth and branding. Gaps: no office HTTP permission matrix, no coverage gate.

## Target shape (refactor plan)

See `docs/superpowers/plans/2026-11-08-architecture-refactor.md`. Short form: `modules/shared` (PrismaService, ActorGuard + `@Actor()`, `@RequireGrant`, global exception filter, activity interceptor, paging, money, validation) plus one module per domain — `wallets`, `lines`, `packages`, `providers`, `companies`, `tasks`, `users`, `transfers`, `notices`, `audit`, `catalog-seed` — each with `controller / service / repository / dto / rules / spec`. Endpoint paths and response shapes stay identical (`response-shape.spec.ts` guards them).
