# Backend codemap — `apps/api`

Living map of the API. Read this instead of re-reading `src/`. **Update it in the same commit** whenever a module, endpoint group, model, or responsibility changes (see `CLAUDE.md` → "Keep the maps current").

Last verified: 2026-11-10 (backend hardening, plan `docs/superpowers/plans/2026-11-10-backend-hardening.md`). tsc clean
with `noUnusedLocals`, lint clean with no size exceptions, 890 specs + 5 PostgreSQL specs, every guard in
`src/architecture.spec.ts` at 0. History of what changed lives in git and in the plans, not on this line.

## Rules

`.cursor/rules/backend-engineering.mdc` is the law for this app; `src/architecture.spec.ts` enforces it on every test
run (a ratchet: a rule's violation count may only go down). Read it before the first change.

## How a request runs

1. Middleware, on every route: `OriginMiddleware` (a write from another site is 403) → `RateLimitMiddleware` →
   `DoorMiddleware`.
2. Global providers (`modules/shared/api-providers.ts`, registered in `AppModule` and in every HTTP spec app):
   `ApiExceptionFilter` (every error is `{ message, code }`) and `EmptyBodyPipe` (a missing body is `{}`).
3. Office controllers: `ActivityInterceptor` then `ActorInterceptor`; the handler gets `@Actor()`.
4. The service: permission through `office/policy.ts` → `parseInput(<Schema>, body)` from `<domain>.schemas.ts` →
   rules (`office/rules/`, pure) → Prisma. Money and status changes run in `kernel.runTx` on locked rows.
5. A line operation asks `ProviderGateway` whether the provider ran it; a refusal or a manual mode opens a task.

## Stack

NestJS 12 · Prisma 7 (`@prisma/adapter-pg`, PostgreSQL) · BullMQ + ioredis · argon2 · otplib (TOTP) · Swagger at `/docs` (non-production only) · Jest 30 + ts-jest 29 + supertest.

## Entry points

| File | Role |
|---|---|
| `src/main.ts` | bootstrap: no `X-Powered-By`, security headers (`security-headers.ts`), JSON bodies only (1mb; no urlencoded parser), `trust proxy` from `TRUST_PROXY`, CORS (`cors.ts`), OpenAPI (`openapi/`), and a warning per unsafe production setting (`config.ts` `productionWarnings`). |
| `src/config.ts` | the only reader of `process.env` (`env(name)`, `isProduction()`, `isTest()`); lists every variable the API knows |
| `src/origin.middleware.ts` | a write whose `Origin` is not the web app (a configured origin, or a door host of the same site) is 403: the CSRF defence beside `SameSite=Lax` |
| `src/app.module.ts` | imports `featureModules` from `modules/registry.ts` + `HealthController`; `API_PROVIDERS`; middleware `OriginMiddleware`, `RateLimitMiddleware`, `DoorMiddleware` on every route |
| `src/rate-limit.middleware.ts` | per signed-in session (SHA-256 of `sid`), one-minute window in Redis (memory without `REDIS_URL`): 600 requests, 60 of them writes → `429 RATE_LIMITED` + `Retry-After`; the notices stream, `/health` and calls without a session are not counted; sign-in routes (`/auth/login`, passkey login, `/office/handoff`) are capped per network address (30 a minute; off in production unless `TRUST_PROXY` is set); a Redis failure lets the request through |
| `modules/shared/duplicate-guard.interceptor.ts` | global (`APP_INTERCEPTOR` in `OfficeModule`): an `/office/` write repeated by the same session (same method, URL, body within 10 s, or the same `Idempotency-Key` within 24 h) runs once — `409 DUPLICATE_REQUEST` while the first runs, the first answer after (header `Idempotent-Replay: true`); a key reused for another route or body is 400. It fails open on a Redis error: the row locks are the protection, this is a convenience |
| `src/door.middleware.ts`, `src/doors.ts` | resolves the door (layer) from the `x-door` header; the session's own account must belong to that door. An entered (impersonation) session is judged by the entered account's layer, so it opens on that account's door and the admin door refuses it. The `sid` cookie is shared by every door (`COOKIE_DOMAIN`), so `POST auth/login`, `auth/passkey-login(/options)` and `office/handoff` pass whatever session the browser brings: they replace it (`door.middleware.spec.ts`) |
| `src/worker.ts` | BullMQ worker, no processors yet; daily `activityEvent` purge via `setInterval` |
| `src/errors.ts` | `ERROR_MESSAGES` catalog (code → message), tested; `apps/web/scripts/check-copy.mjs` requires each code in ar/en/he |
| `src/db.ts` | `createPrismaClient()` — called by `PrismaService` (and the worker); specs that build services by hand fall back to it |
| `tsconfig.build.json` | `npm run build` (and the Docker image) compiles `src/` without specs and test helpers (every `testing/` folder, `*.fixture.ts`); `tsconfig.json` keeps them for typecheck and jest |
| `src/generated/` | Prisma client output — generated, never edit, git-ignored |
| `modules/shared/` | `prisma.service.ts` (global `PrismaModule`, one client per process), `office-failure.ts` (`OfficeFailure`, `fail()`), `api-exception.filter.ts` + `empty-body.pipe.ts` + `api-providers.ts`, `input.ts` (`parseInput(schema, body)` → 400 INVALID), `schemas.ts` (zod pieces: `agorot`, `text(max)`, `note`, `loginName`, `msisdn`, …), `cookies.ts` (`readCookie`, `gateOf`, `cookieBase`, `Gate`), `dates.ts` (`dayRange`, UTC), `prisma-errors.ts`, `log.ts` |
| `openapi/body.ts` | `ApiZodBody(schema)`: a route's body is documented from the schema that validates it |

## Modules

| Module | Files | Owns |
|---|---|---|
| `auth/` | controller, service, `auth.store.ts` (in-memory, specs), `prisma-auth.store.ts` (Postgres + Redis: live session keys and the failed-login counter `login-fail:<login>`), `decide-login`, `password`, `totp`, `sessions`, `validators`, `trial-seed`, `cities`, `one-time-code.ts` (SMS/email codes: 6 digits, 5 min, 5 tries, hashed, resend every 30 s), `message-sender.ts` (`MESSAGE_SENDER` → `LogSender` until the SMS/email gateways are chosen), `passkeys.ts` (`PasskeyService` on `@simplewebauthn/server`; RP ID from `WEBAUTHN_RP_ID` or the origin host without its first label) | login, sessions (cookie `sid`; sessions allowed and idle time per account → layer → default 3 / 6 h, `sessions.ts` `effectiveRules`; the store's `liveSession` closes a session idle past its rules and returns them; `GET /auth/session-rules`, `PATCH /auth/session-rules/:layer`, `GET|PATCH /auth/users/:loginName/session-rules`, branch owner only; «إعدادات المستخدم»: `GET /auth/users/:loginName/settings` (email, phone, 2FA state) and `PATCH /auth/users/:loginName/contact` (email and phone, empty clears), branch owner only, `user-settings.http.spec.ts`), 2FA by app, SMS or email (`User.twoFactorMethod`; `GET /auth/sign-in-methods`, `POST /auth/two-factor/method(+/confirm)`, `POST /auth/two-factor/send`), passkeys (`Passkey` model; `GET/POST /auth/passkeys`, `POST /auth/passkeys/options`, `DELETE /auth/passkeys/:id`, `POST /auth/passkey-login(+/options)` — a passkey stands for the password and the second step), password change, trial accounts. Store behind `AUTH_STORE` token; short-lived codes and challenges in Redis `auth-secret:*`. |
| `branding/` | controller, service, store (memory + prisma), rules | site identity (logo, title, icon). Small and clean — the reference shape for other modules. |
| `office/` (root) | `office.module.ts` (`OFFICE_CONTROLLERS`, `OFFICE_PROVIDERS`), `policy.ts` (who may do what: `holds`, `requireGrant`, `requireOwner`, `isOwner`, `seesLayer`, `layerRank`), `stored-text.ts` (the only sentences the API writes into the database) | every route lives in a domain controller below |
| `office/rules/` | pure, tested: `office-rules` (modes, SIM rules, paid periods, refunds), `user-terms`, `line-prices`, `profit-ladder`, `office-terms`, `office-grants`, `office-paging` | no Nest, no Prisma |
| `office/activity/` | `activity.decorator.ts` (`@Activity(action, kind, subject)` — `action` must be in `ACTIVITY_ACTIONS` — and `@NoActivity(why)`), `activity.interceptor.ts`, `activity-recorder.ts`, `activity-log.ts`, `activity.module.ts` | the audit trail; every office write carries one of the two decorators |
| `office/testing/` | **test-only**: `tree.fixture.ts` (in-memory office), `office-graph.ts` (`OfficeGraph`: the collaborators wired by hand for specs), `office-facade.ts` (`(gate, …)` adapter the service specs call), `office-test-app.ts` (HTTP spec app), `office-routes.ts` (every route and its activity event), `test-hash.ts`, and the cross-domain contract specs (`routes.http`, `permissions.http`, `response-shape`, `office-errors`, `office-lists`) | not in the build |
| `office/catalog/` | `catalog-seed.ts` (`CatalogSeed`: shipped catalog + layer roles at boot; skipped under tests / without a DB) | — |
| `office/kernel/` | `unit-of-work.ts` (`UnitOfWork`: the client, `runTx`, notices queued until commit; spec hook `prismaClient`), `account-tree.ts` (`AccountTree`: `accounts(db)`, `pathOf`, `chainIds`, `visibleAccount`; `nodeOf`), `actor-resolver.ts` (`ActorResolver`: `actor(gate)`, `grantsFor(user, db)`; the operator of an entered session comes from `Session.operatorId`, never from a cookie), `actor.interceptor.ts` (`ActorInterceptor`, `@Actor()`), `kernel.providers.ts` (`KERNEL_PROVIDERS`), `types.ts` (`Actor`, `Account`, `Sale`, `Action`), `feed.ts`, `line-terms.ts`, `sale.ts`, `query.ts` (`text`), `values.ts` | what every office domain may use and nothing domain-specific. There is no kernel class any more (taken apart 2026-11-10): a service injects the collaborators it calls. Beside their domains: `wallets/wallet-ledger.ts` (`WalletLedger`: `lockWallets`, `hold`, `release`, `move`, `recordOp` — the only writer of wallets), `terms/price-ladder.ts` (`PriceLadder`: `termsFor`, `ladderRows`, `stampWith`), `lines/line-access.ts` (`LineAccess`: `visibleLine`), `roles/layer-roles.ts` (`LayerRoles`). `testing/routes.http.spec.ts` pins all 117 routes (method, path, activity event, anonymous answer); `testing/permissions.http.spec.ts` pins who gets past each route's permission check. Checked grants: `edit`, `tasks`, `reports`, `staff`, `enter`, transfers; `read` and `accounting` are not checked yet (ADR 0006). Every check goes through `office/policy.ts` (which also holds `assertBranch`). |
| `office/notices/` | `notice-inbox.service.ts` (`NoticeInboxService`: list, read, subscribe), `notices.controller.ts` | `GET /office/notices`, `GET /office/notices/stream` (SSE; the session is checked again on every 25 s beat), `POST /office/notices/read` |
| `office/audit/` | `audit.service.ts` (`AuditService.list` — with `addresses=1` also how many network addresses the matching events came from —, `AuditService.csv`, at most 5,000 events), `audit.controller.ts` | `GET /office/audit`, `GET /office/audit/export` (CSV, same filters) |
| `office/tasks/` | `tasks.service.ts` (`TasksService`: list, detail, addNote (`internal`: the branch only — hidden from other readers and their notices), take (names the handler of an open task), release, reject, cancel; a task opens as `working` (no `pending` since 2026-11-09) and any handler finishes or closes it, the completion claiming the row first so two at once cannot both run; `task-notes.spec.ts`; `openTask`, `taskNotice`, `noteLog` used by line ops), `task-events.ts` (pure), `task-access.ts`, `task-log.ts`, `tasks.controller.ts`. `openTask` locks the line and refuses a second open task for the same number and operation (`409 DUPLICATE_REQUEST`; add-ons excepted) and stores `unitPrice` | `GET /office/tasks`, `GET tasks/:id`, `POST tasks/:id/{notes,take,release,reject,cancel}`. `POST tasks/:id/complete` is served by `LinesController` and applied by `lines/task-completion.ts`. |
| `office/wallets/` | `wallets.service.ts` (`WalletsService`: list, fund, setCeiling, ledger (the viewer's own wallet, `audit` scope only), finance (`scope=money` money movements, `scope=operations` line operations, every entry otherwise), financeSummary — over 7, 30 or 90 days (`?days=`, `summaryDays`), with the movements made by hand (`manual`) —, financeCsv), `wallets.controller.ts`, `provider-cost.ts` (`pricedOp`, `PROVIDER_OPERATION_KINDS`), `profit-ladder.ts` beside the office rules (each layer's margin on a sale; `WalletEntry.ladder` keeps the chain), `finance-summary.ts` (`walletSummary`: 30-day in/out and end-of-day balances, UTC days; `ledgerCsv`: BOM, shekels, formula-safe cells) | `GET /office/wallets`, `POST wallets/:login/fund` (with `reason`), `POST wallets/:login/deduct` (child → parent, reason and note), `PATCH wallets/:login/ceiling`, `GET ledger/:scope` (`operations`: the line operations of the viewer's whole tree — every account for the branch, `visibleAccountIds` below — each with `loginName`, `layer` and the viewer's `margin`; `audit`: the viewer's own wallet; `operations-ledger.spec.ts`), `GET finance`, `GET finance/summary` (own wallet, with `profit` and `sales`), `GET finance/profits` (profit by package and period) and `finance/profits/export` (CSV), `GET finance/export` (CSV, same filters, 10,000 rows); `finance` reads every entry of the viewer and the accounts below it, operations that move no money included, unless `scope=money`; for the branch each sale or refund carries `shares` (every account's margin, branch first; `laddersFor` + `sharesOf`, `finance-ledger.spec.ts`), `GET provider-operations` |
| `office/providers/` | `providers.service.ts` (`ProvidersService`: list, settings, setEsimPrice, setMode), `providers.controller.ts` | `GET /office/providers`, `GET/PATCH providers/:code/settings`, `PATCH providers/:code/esim-price` |
| `office/providers/` (accounts) | `provider-accounts.service.ts` (`ProviderAccountsService`: list, detail with a running-balance ledger, CSV, payments and settlements, credit limit, statement preview, reconciliation runs and their differences — `statement.ts` reads xlsx/csv with `exceljs` and matches; read: owner, `accounting` or `reports`; write: owner or `accounting`), `provider-accounts.controller.ts`; model `ProviderEntry`, `Provider.creditLimit`; purchases come from `WalletsService.pricedOperations` | `GET /office/provider-accounts`, `GET provider-accounts/:code`, `GET …/:code/export`, `POST …/:code/entries`, `PATCH …/:code/credit`, `POST …/:code/statements/preview`, `GET/POST …/:code/reconciliations`, `GET /office/reconciliations/:id`, `PATCH /office/reconciliation-items/:id` |
| `office/providers/` (health) | `provider-health.ts` (pure: `healthOf` — problem after `FAILURE_THRESHOLD` 3 tasks noted `PROVIDER_FAILED_NOTE` in `FAILURE_WINDOW_MINUTES` 60, or available under `Provider.alertFloor`), `provider-health.service.ts` (`ProviderHealthService`: `current()` for the overview; every `HEALTH_CHECK_SECONDS` 120 `check()` compares with `Provider.health` by compare-and-set and writes `provider.problem` / `provider.recovered` to the branch owner and staff with `edit`, sender «النظام»; `checkMatching()` on the same timer sends `provider.match_overdue` once per lapse for a statement provider past `matchEveryDays` (`Provider.matchOverdueNoticeAt`, cleared by a new match); off under tests and without a DB) | the overview's providers card and banner; `PATCH provider-accounts/:code/credit` also takes `alertFloor` |
| `office/providers/` (matching) | `match-simulator.ts` (pure, simulated until real providers are connected: `simulatedCharge` — our cost, a stable 1–5 ₪ difference for about one operation in twelve; `matchOf` — `api` matched at once, `statement` only up to `Provider.lastMatchedAt`; `matchOverdue` past `matchEveryDays`) | `GET provider-operations` rows carry `matchSource`, `matchState`, `providerAmount`, `difference` (filter `match=`), its stats `matched`/`differences`/`pending`/`differenceAmount`; provider summaries carry `matchSource`, `matchEveryDays`, `lastMatchedAt`, `matchOverdue`, `openDifferences`; `PATCH provider-accounts/:code/matching`, `POST provider-accounts/:code/simulate-statement` (owner or `accounting`) |
| `office/providers/gateway/` | `provider-gateway.ts` (`ProviderGateway` port: `accept(hint)`, `run(request)`; token `PROVIDER_GATEWAY`), `simulated-gateway.ts` (answers the request's `outcome` hint; `PROVIDER_SIMULATION=0` turns it off; warns when it runs in production) | every line operation; a real provider is a new class bound to the token |
| `office/providers/` (catalog) | `adapters/provider-adapter.ts` (`ProviderAdapter`: `companies()`, `products(company)`), `adapters/simulated-adapter.ts` (`SimulatedProviderAdapter`, `adapterFor` — every provider simulated until its real adapter exists: the seeded packages under their codes, more tiers, two new companies), `provider-catalog.service.ts` (`ProviderCatalogService`: companies/products marked `added`, createCompany, createPackage — inherited modes, own modes, add-ons, ladders checked; owner or `edit`; spec 2026-11-09-admin-review, 3), `provider-catalog.controller.ts` | `GET /office/providers/:code/catalog/companies`, `GET …/catalog/products?company=`, `POST /office/companies`, `POST /office/packages`; errors `COMPANY_EXISTS`, `PACKAGE_EXISTS`, `PRODUCT_NOT_FOUND` |
| `office/offers/` | `offers.service.ts` (`OffersService`: live — the account's active offers for its layer inside their dates, in order; list, save, move, remove — branch owner or `edit`; picture a png/jpeg/webp data URL ≤ ~700 KB, `IMAGE_TOO_LARGE`; link a `/path` or `https://`; seconds 3–60; `offers.service.spec.ts`), `offers.controller.ts`; model `Offer` | `GET /office/offers/live`, `GET|POST /office/offers`, `PATCH|DELETE /office/offers/:id`, `POST /office/offers/:id/move` |
| `office/companies/` | `companies.service.ts` (`CompaniesService`: shelf, setSim, setImage), `companies.controller.ts` | `GET /office/companies`, `PUT companies/:code/sim`, `POST companies/image` |
| `office/packages/` | `packages.service.ts` (`PackagesService`: list, setSellPrice, clearSellPrice, setMode, sheet, setDetails, setChain, setTargets), `packages.controller.ts`. Package details: `dataGb`, `smsCount`, `minutes` (null not stated, −1 unlimited), `details` (≤300), `suspendAfterDays` (1–3650, default 90), `esimAvailable` (default true; eSIM needs the company and the package — `simRulesOf(company, pkg)`; the company refusing answers `ESIM_UNSUPPORTED`, the package `ESIM_PACKAGE_OFF`; `esim-package.spec.ts`) | `GET /office/packages`, `PUT/DELETE packages/:code/sell-price`, `PATCH packages/:code/mode`, `GET packages/:code/sheet`, `PATCH packages/:code/details`, `PUT packages/:code/{chain,renewals,switches}`, `GET|POST packages/:code/addons`, `PATCH|DELETE packages/:code/addons/:id` (extra operations: `PackageAddon` name, price, on/off, order; edit grant); `GET /office/companies` packages carry the facts and the branch/main prices |
| `office/terms/` | `terms.service.ts` (`TermsService`: userPackages, setUserPackage, setUserPackagesBulk, userOps, setUserOps, customPrices, setCustomPrice, clearCustomPrice, linePrices, setLinePrices, repriceLines), `terms.controller.ts` | `GET/PUT users/:login/packages[/:code]`, `GET/PUT users/:login/ops`, `GET/PUT/DELETE packages/:code/custom-prices[/:login]`, `GET/PUT packages/:code/line-prices` |
| `office/accounts/` | `accounts.service.ts` (`AccountsService`: list, page, directory, create, setPassword, detail, saveAccess, setFrozen, remove, enter), `accounts.controller.ts`; `users-page.ts` (`usersPage`: order, `q`/`layer` filters, cursor, 50 a page), `account-session.{service,controller}.ts` (`handoff` and `leave`, deliberately without ActorInterceptor), `handoff.ts` (code TTL and key) | `GET /office/users` (everything visible; `?paged=1&q&layer&cursor` → `{ users, nextCursor, total }`), `GET directory`, `POST users`, `POST users/:login/{password,freeze,restore,enter}` (`enter` answers `{ door, code }`: the entered account's door and a one-time handoff code, 60 s, in `auth-secret:handoff:*`; it no longer sets cookies), `GET users/:login` (with `listed`: the account as the list shows it to this viewer), `PATCH users/:login/access`, `DELETE users/:login`, `POST handoff` (on the entered account's door: trades the code for `sid` = entered session and `home` = owner session; no session needed), `POST leave` (puts `sid` back from `home`, else clears it) |
| `office/roles/` | `roles.service.ts` (`RolesService`: list, save), `roles.controller.ts` | `GET/POST /office/roles` |
| `office/desk/` | `desk.service.ts` (`DeskService`: me, home), `overview.service.ts` (`OverviewService`: the home's full picture — lines now by slice, sales with refunds, net, the viewer's profit and a daily trend, top packages/companies/providers, the most active accounts per layer below, users with debt and ceilings, tasks by status and the oldest open one, and for the branch with reports or accounting each provider's period use, balance and status; `periodStart` day / month / all in UTC; `pulse` — the home's period cards: sales count and volume, activations and the viewer's profit for the period, the same totals over the same elapsed span of yesterday or of last month (`previous`, null over all time), and a trend by hour today, by day this month, and over all time by hour, day or month by the history's age — from `pulse.ts`, pure, with `pulse.spec.ts`; `overview.service.spec.ts`), `desk.controller.ts` | `GET /office/me`, `GET home`, `GET overview?period=day\|month\|all` |
| `office/transfers/` | `transfers.service.ts` (`TransfersService`: transferAccount, transferPreview, transferLine; uses `TermsService.repriceLines`), `transfers.controller.ts` | `POST users/:login/transfer`, `GET users/:login/transfer-preview`, `POST lines/:id/transfer` |
| `office/lines/` | `lines.service.ts` (`LinesService`: activate, operate, disconnectQuote, switchPackage, extend, reactivate, refresh, rename, swapSim, requestEsim, requestAddon; each either runs now on the locked line or opens a task), `line-reads.ts` (`LineReads`: list, detail), `line-pricing.ts` (`LinePricing`: buy price, renewal stamp, disconnect settlement, switch quote, fresh number — each takes the client to read with), `task-completion.ts` (`TaskCompletion`: one handler per action, on the claimed task and the locked line), `line-state.ts` (`lockLine`, `lockUnchanged`, `moveLineStatus`, `assertTaskFits`, `assertSimFree`), `line-ops.ts` and `line-history.ts` (pure), `line-input.ts`, `lines.schemas.ts`, `office-esim.ts`, `lines.controller.ts` | `GET/POST /office/lines`, `GET lines/:id`, `POST lines/:id/{charge,freeze,unfreeze,disconnect,extend,reactivate,refresh,rename,sim,esim,switch,company-switch}`, `GET lines/:id/disconnect-quote`, `POST lines/:id/addon` (one of the package's extra operations: always a manual task holding its price, charged on completion under the add-on's name, kind `addon`; the card lists the live ones as `addons`; `addons.spec.ts`), `POST tasks/:id/complete` `GET /office/lines?status=suspended` narrows to suspended lines (active or marked suspended, ended at least the package's `suspendAfterDays` ago — default 90; `office-paging.ts` `isSuspended`, `suspendedWhere`, one cut-off per period in use), and every row carries `suspended`. `GET /office/lines?account=<login>` narrows to that account's numbers (its own, or every point of sale below it, inside the viewer's tree). `GET /office/lines?status=expiring` narrows to active lines ending within `EXPIRING_DAYS` (3; `office-paging.ts` `expiringWhere`); the home's `expiringLines` counts them. |
| `office/reports/` | `reports.service.ts` (`ReportsService`: the older branch lists — providers, operations, tasks, numbers), `insights.service.ts` (`InsightsService`: the «التقارير» page — balances under the viewer, providers per period for the branch with the reports grant; 5,000 rows, `capped`; sales and orders removed 2026-11-09, spec admin-review §1), `report-csv.ts` (`csvOf`), `reports.controller.ts` | `GET /office/reports/{balances,supply}`, `GET reports/:kind/export` (CSV), then `GET /office/reports/:kind` |
| `activity` (in `office/activity.module.ts`) | `activity-recorder.ts`, `activity-log.ts` | audit/activity events |

### `office` endpoint groups

Every route is in a domain controller (table above). `testing/routes.http.spec.ts` lists all 117 with method, path, activity event and anonymous answer.

### Pure rule files (well tested, keep pure)

`office/rules/*` (above), plus beside their domain: `transfers/transfer-rules.ts`, `tasks/task-access.ts`, `tasks/task-log.ts`, `tasks/task-events.ts`, `lines/line-ops.ts`, `lines/line-history.ts`, `notices/notice-kinds.ts`, `catalog/office-catalog.ts`, `lines/office-esim.ts`, `desk/pulse.ts`, `providers/provider-health.ts`, `providers/match-simulator.ts`, `wallets/finance-summary.ts`.

## Cross-cutting patterns

- **Permissions:** `ActorInterceptor` resolves the actor before the handler (declared after `ActivityInterceptor`, so
  refused sessions are still logged; pipes run after it, so 401 precedes 400). Services ask `office/policy.ts`
  (`requireGrant(actor, 'edit')`, `holds`, `requireOwner`, `refuseEntered`); none reads `actor.grants` itself.
  `testing/permissions.http.spec.ts` pins who gets past every route. An entered session cannot use `/auth` writes
  and only an account below the branch can be entered.
- **Errors:** `fail(status, code)` throws `OfficeFailure`; `ApiExceptionFilter` answers `{ message, code }` for it,
  for framework errors, for a lost unique race (409) and a missing row (404); anything else is 500 `SERVER_ERROR`,
  logged. Status table: 400 invalid or refused by a rule · 401 no session · 403 not allowed · 404 missing or not
  visible · 409 conflict (`*_TAKEN`, `*_EXISTS`, `DUPLICATE_REQUEST`) · 429 rate limit.
- **Validation:** every body is parsed by a zod schema in `<domain>/<domain>.schemas.ts` through `parseInput()`
  right after the permission check (ADR 0002, finished 2026-11-10). Specific error codes keep their own checks.
  Query filters are still read with `text()`.
- **Activity log:** `@Activity(action, subjectKind, subject)` or `@NoActivity(why)` on every office write. The auth
  owner routes record through `ActivityRecorder` in the controller.
- **Persistence:** `PrismaService` is injected; `runTx` = `$transaction` at Read Committed, notices published after
  commit.
- **Money:** Int agorot. `move()` locks the wallet row before reading it (ADR 0004); two wallets are locked in
  sorted order (`lockWallets`); a line is locked before any wallet. A task holds its price while open and charges
  the price it was opened at. Proof: `wallets/wallet-concurrency.db.spec.ts`, `lines/line-concurrency.db.spec.ts`
  (PostgreSQL, CI `db` job).
- **Line state:** a status changes only through `moveLineStatus` (guarded) on a line locked with `lockLine`; a
  request validated before the transaction calls `lockUnchanged` first (409 when another operation got there
  first); a task whose line moved on is refused (`assertTaskFits`). A live SIM serial belongs to one number
  (`assertSimFree`, advisory lock on the serial).
- **Prices by layer:** `GET /office/packages` gives a layer its own column and the ones below; the rest is `null`.
- **Visibility:** `accounts()` loads all users and filters in memory.
- **Seeding:** `CatalogSeed.onModuleInit` runs `ensureCatalog` and the layer roles on every start (idempotent).
- **Config and logs:** `config.ts` only; Nest `Logger` only (`shared/log.ts`).

## Data model (`prisma/schema.prisma`, 50 migrations)

User, Session, Role, UserRole, LayerPolicy, Wallet, WalletEntry, Provider, ProviderEntry, Company, Package,
PackageRenewal, PackageSwitch, UserPackage, SellPrice, Line, OfficeTask, OfficeTaskNote, ActivityEvent, AccessLog,
Notice, LineCountSnapshot, SiteBranding, ProviderReconciliation, ProviderReconItem, Passkey, PackageAddon, Offer.

Status/kind/layer fields are `String`; the database refuses unknown values with CHECK constraints added as
`NOT VALID` (`Line.status`, `OfficeTask.status`, `Wallet.held >= 0`). Foreign keys (2026-11-10):
`WalletEntry.lineId` → `Line` (SET NULL), `OfficeTask.posId` → `User`, `OfficeTask.packageId` / `nextPackageId` →
`Package`. `OfficeTask.unitPrice` is the price the task was opened at; `Session.operatorId` is who entered. Task
statuses: `working`, `done`, `cancelled` (`pending` was retired; old rows were migrated). `prisma migrate diff`
against the migrations is empty.

## Tests

84 spec files beside what they test. Service specs run on `office/testing/tree.fixture.ts` through
`office/testing/office-facade.ts`; HTTP specs through `office/testing/office-test-app.ts` (or `Test.createTestingModule`
with `API_PROVIDERS`). Two `*.db.spec.ts` files need PostgreSQL (`TEST_DATABASE_URL`; the CI `db` job gives them
one). `src/architecture.spec.ts` checks the engineering rules. Locally: one spec file at a time with
`npm test --workspace api -- --forceExit <path>` (plain `npx jest` fails on ESM).

## Known gaps (not done yet)

- `OfficeModule` is still one Nest module with 18 controllers, and services still call Prisma directly (228
  call sites, guard `prisma-in-service`). One module per domain and a repository per domain are phases M and R of
  `docs/superpowers/plans/2026-11-10-office-kernel-split.md`; the kernel itself is gone (phase K done).
- `rules/office-rules.ts` mixes modes, SIM rules and refund periods; split by topic.
- Session ids are stored as written (review S6) and TOTP secrets in clear (S12); both need a migration of live
  sessions and secrets.
- Lists without paging (`wallets`, `directory`, `packages`, `companies`, `offers`) and the three cursor formats
  (review A7); route naming and the two `reports/:kind` generations (A8, A12) need the web app to move with them.
- `session-rules` and `users/:login/contact` in `/auth` are not in the activity log: they need new action names and
  their labels in the web audit screen.
- Query-string filters are not schema-validated; an unknown filter value is still ignored.
- Real provider adapters and the SMS/email gateways do not exist: `SimulatedProviderGateway` and `LogSender`.
