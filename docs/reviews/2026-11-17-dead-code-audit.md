# Dead code, unused files and finished plans — audit (2026-11-17)

Read-only audit of `main` at `966fa1f4` (clean tree). Nothing was deleted or changed; this file is the only write.
Every finding carries its proof. Where something is inferred rather than proved, it says so.

Tools used: `git grep` / `grep` over tracked files, small Node scripts kept outside the repository (scratchpad), and
`knip@5` in report-only mode with a config passed from the scratchpad (`--config`, `--no-exit-code`; nothing was
added to the repository or to `package.json`). knip's output was treated as leads; every lead below was checked by
hand. `npm run check:copy` and `npm run check:styles` were run (both pass, exit 0). Lint, typecheck and the suites
were not run (not needed for a read-only audit).

Confidence: **certain** — nothing can reach it (no import, no name in a string, no convention); **likely** — reached
only by name or convention and no user was found; **owner's call** — unused today, but it looks like a feature, a
kept fallback or a primitive the design system lists.

## Summary

| Category | Findings | Certain | Likely | Owner's call | Size that can go (estimate) |
|---|---|---|---|---|---|
| 1. API dead code | 8 | 7 | 1 | — | 1 file; ~25 lines; one compatibility branch in 3 places |
| 1b. API routes with no caller | 8 | — | — | 8 | per route: controller method, service path, spec rows |
| 2. Web dead code | 14 | 9 | 1 | 4 | 3 files (163 lines); ~90 lines of symbols; 3 copy keys × 3 languages |
| 2b. Web screens and scripts | 3 | — | — | 3 | `/reports/[kind]` screen; `tests/dom-snapshot.mjs` (789 lines) |
| 3. Dependencies | 2 | 2 | — | — | `cookie-parser`, `@types/cookie-parser` |
| 4. Database leftovers | 1 | — | 1 | — | none needs a migration |
| 5. Files and folders | 4 | 1 | — | 3 | the Excalidraw boards (13.8k lines JSON) + generator, 3 docs |
| 6. Plans | 54 plans | 45 finished or superseded | — | 9 kept (open) | 45 files, ~6,270 lines |
| 6b. Specs | 79 specs | — | — | 42 unreferenced | up to 42 files (owner's call) |
| 6c. Docs that contradict the code | 20 | — | — | — | rewording only |
| 7. Comments that outlived their subject | ~1,100 history-style references; ~185 name deleted stylesheets | — | — | — | rule proposal below |

Biggest items: the 45 finished/superseded plans (~6.3k lines); the Excalidraw boards, which are no longer generated
from the current code (13.8k lines of JSON); `apps/web/tests/dom-snapshot.mjs` (789 lines, the check of a superseded
plan); the "Last verified" history lines in the two maps (one line of 29k characters in `frontend.md`, three of
8–10k in `backend.md`); ~185 comment references to stylesheets that were deleted in Tailwind migration T5.1.

The guards already catch a lot, and it shows: every API error code is raised by production code, every activity
action is recorded, every notice kind is written, every environment variable is read, every registered provider is
injected (or bound to a port), every API test helper is imported by a spec, every `--rd-*` token but one is read, and
every class / `data-slot` / `@utility` selector of `app/tailwind.css` has markup (proofs in "Checked and clean").

---

## 1. Dead code in `apps/api/src`

| # | Thing | Proof | Confidence | Removing it touches |
|---|---|---|---|---|
| A1 | `modules/platform/query.ts` (whole file, `text()`) | knip: "Unused files … platform/query.ts". `git grep -nE "['\"]\./query\|['\"]\.\./query\|platform/query" -- apps/api` → only `openapi/query` (a different file). Last touched by `cf984d4b` (slice R.3). | certain | `docs/architecture/backend.md:56` names it (`query.ts` (`text`)): reword |
| A2 | `platform/paging.ts` `PAGE_MAX` | `grep -cw PAGE_MAX paging.ts` = 1 (its declaration); `git grep -lw PAGE_MAX -- 'apps/**/*.ts'` → only that file | certain | nothing |
| A3 | `platform/values.ts` `nonNegative` | declared once; the only other hit is a comment in `wallets/wallets.schemas.spec.ts:18` | certain | the spec comment |
| A4 | `platform/schemas.ts` `msisdn` (l.32) and `iccid` (l.35) | knip "unused export"; `grep -cw` in the file = 1 each; `git grep -nP "(import\|export)[^;]*\bmsisdn\b"` finds no import of them (every other hit is a field of the same name) | certain | nothing (`lines.schemas.ts` has its own) |
| A5 | `catalog/index.ts` re-exports `durationDays`, `DurationUnit`; `platform/index.ts` re-exports `SystemAlertNoticePayload` | scratch script over every module surface: names that no file outside the module uses (prod or test) — these three are the only ones in 13 surfaces | certain | drop the names from the surface; the definitions stay (used inside the module) |
| A6 | `platform/cookies.ts:9-12` the "from cookie-parser when it ran" branch of `readCookie` | `cookie-parser` is never mounted: `git grep -n "cookieParser\|cookie-parser" apps/api/src` → only this comment; `git log -S"cookieParser" -- apps/api/src/main.ts` → nothing, ever; no spec sets `req.cookies` (`git grep -nP "cookies\s*:" apps/api/src`) | certain | `cookies.ts` (2 lines + comment); goes with D1 |
| A7 | Retired task status `'pending'` still handled: `providers/account/provider-accounts.service.ts:16` `OPEN_TASKS = ['pending', 'working']`; `reporting/desk/overview.service.ts:21` `TASK_STATUSES` includes `'pending'`; web `components/names.ts:115` | migrations `20261109100000_task_internal_notes` and `20261110100000_task_unit_price_and_pending` rewrote every `pending` task to `working`; `20261110110000_task_and_entry_keys:26` adds `CHECK ("status" IN ('working','done','rejected','cancelled'))` (NOT VALID: new rows only, and no old ones remain after the updates) | likely (compatibility path for data the migrations rewrote) | **overview's `TASK_STATUSES` may shape an answer** (a `pending: 0` count): check `testing/response-shape.spec.ts` and the home screen before removing; behaviour-preserving only if the key is not in the response |
| A8 | 229 names exported but used only inside their own file (e.g. `LEDGER_LIMIT`, `RELAY_BATCH`, `SWEEP_PAGE`, most `*Props`/row types) | knip "Unused exports (86)" + "Unused exported types (94)", re-checked per name: `grep -cw name file` > 1 for 229 of 269 | certain (the `export` keyword only) | drop `export`; no behaviour. Low value — a slice of its own, or skip |

Checked and **not** dead (do not remove): the empty `index.ts` of `auditing`, `monitoring`, `reporting` (knip lists
them as unused files; they are the module surfaces that `architecture-boundaries.spec.ts:131-143` requires for every
module, and each says "nothing of it is imported by another module today").

### 1b. Routes with no caller (owner's call each; none is deleted silently)

Method: every row of `modules/testing/routes.ts` (144) and every route of the `auth`, `branding` and health controllers
compared with the calls in `apps/web` (`request('<METHOD>', '<path>')`, the CSV `…ExportHref` links, the
`EventSource` of `lib/use-notices.ts`, the Next route handler `app/system/versions/data/route.ts`), `scripts/`, the CI
file and `docs/handover/`.

| # | Route | Proof | Confidence | Note |
|---|---|---|---|---|
| R1 | `GET /v1/wallets` (`wallets.controller.ts:18`, `WalletsService.list`) | no `request('GET', '/v1/wallets…')` in the web (`wallets/api.ts` has only `fund`, `deduct`, `ceiling`); not in `scripts/` nor the handover | owner's call | a list no screen shows; the balances report (`/v1/reports/balances`) covers it |
| R2 | `POST /v1/lines/:id/reactivate` + web `linesApi.reactivateLine` (`features/lines/api.ts:12`) | `git grep -nw reactivateLine -- apps/web` → its definition only; `line-actions.ts` sends a disconnected line through `chargeLine` | owner's call | old ledger/task rows keep the action name `reactivate` (names, filters): keep those |
| R3 | `PUT /v1/users/:login/packages` (bulk) + web `termsApi.setUserPackagesBulk` (`features/terms/api.ts:18`) | `git grep -nw setUserPackagesBulk -- apps/web` → its definition only | owner's call | |
| R4 | `POST /v1/lines/:id/company-switch` | no web call; `catalog/rules/run-modes.ts:159` "`companySwitch` stays hidden until it has fields" | owner's call | a feature waiting for its fields |
| R5 | `GET /auth/passkeys` (`own-account.controller.ts:165`) | no web call (the passkey list comes with `GET /auth/sign-in-methods`) | owner's call | |
| R6 | `POST /auth/users/:login/password` (`account-security.controller.ts:25`) | the web sets another account's password through `POST /v1/users/:login/password` (`features/accounts/api.ts:15`, `accounts.controller.ts:68`): two routes for one act | owner's call | |
| R7 | `POST /auth/users/:login/disable` (`account-security.controller.ts:61`) | no caller in web, scripts, handover | owner's call | |
| R8 | `PATCH /auth/exemptions/:login` (`account-security.controller.ts:102`) | no caller in web, scripts, handover | owner's call | |
| — | `GET/POST /v1/providers/:code/dispatch…` (5 routes) | no web caller — **keep**: the branch's screens for them are the open S.12b of the activation-settlement plan | not a candidate | |

Removing any route touches `testing/routes.ts` (one row), `routes.http.spec.ts`, `permissions.http.spec.ts`,
`http-security-contract.spec.ts` (for auth writes), the Swagger mapping, `backend.md`, and possibly the copy of its
activity action. Each is a behaviour change: its own slice with the owner's word.

---

## 2. Dead code in `apps/web`

| # | Thing | Proof | Confidence | Removing it touches |
|---|---|---|---|---|
| W1 | `components/sparkline.tsx` (33 lines) | knip unused file; `git grep -nE "/sparkline\|<Sparkline" -- apps/web` → none | certain, owner's call | `DESIGN.md:756` already says "no caller"; `docs/design/current-identity-gaps.md` row 3.6-26 |
| W2 | `components/ui/tooltip.tsx` (56 lines) | knip unused file; `git grep -nE "ui/tooltip\|<Tooltip"` → only the file itself | certain, owner's call | `DESIGN.md:293,302,507,530,1030` (lists it, "no caller"); `generate.mjs:251` |
| W3 | `components/ui/field.tsx` (74 lines) | knip unused file; `git grep -nP "<Field\b\|ui/field"` → none outside the boards | certain, owner's call | `DESIGN.md:281,315,330,411` list it **without** saying it has no caller (see D14); `generate.mjs:239` |
| W4 | `features/auth/session-rules.tsx:145-195` `LayerSessionRulesPane` (~50 lines) | `git grep -lw LayerSessionRulesPane` → its file only; left unused by `bf749fb9` (session rules moved to `/settings/access`, then to the roles screen, which uses `RuleSelects` and the same API) | certain | copy keys `sessionRulesHint`, `sessionRulesSaved` (ar/en/he) are used **only** by it — check:copy will ask for their removal in the same slice |
| W5 | `components/account-name.tsx:13` `useAccountLabel` | declared once, no other file names it | certain | nothing |
| W6 | `components/desk.tsx:186` `whole` | the only `whole(` caller in the web is `versions-screen.tsx:68`, which defines its own | certain | nothing |
| W7 | `lib/cities.ts:54` `cityLabel`; `lib/status-tone.ts:27` `noticeTone` | declared once each, no other file names them | certain | nothing |
| W8 | copy key `posted` (`lib/copy/{ar,en,he}.ts:666`) | check-copy passes it because `tests/offers.spec.ts:60` has a **local variable** named `posted`; no `t.posted` anywhere (`git grep -nw posted -- apps/web ':!apps/web/lib/copy'`) | certain | check-copy will not complain: its name check is by word |
| W9 | Radix part re-exports nothing uses: `ui/dialog.tsx` `DialogTrigger`, `DialogClose`; `ui/popover.tsx` `PopoverClose`; `ui/sheet.tsx` `SheetTrigger`, `SheetClose`, `SheetDescription`; types `DialogMarkTone`, `SheetSide`, `ToastTone` | declared once, no other file names them | certain, owner's call | the "owned primitives" API (ADR 0022) — a complete surface may be wanted |
| W10 | `ui/sheet.tsx` sides `end` and `bottom` | `DESIGN.md:302` "`Sheet end` and `Sheet bottom` are built and have no caller" | certain, owner's call | the variant table in `sheet.tsx:43-60` |
| W11 | `app/tailwind.css:376` `--rd-space-6` | scratch script: of 146 `--rd-*` tokens defined, the only one no `var()` and no source file reads; the comment at l.155 ("`p-6` = `--rd-space-6`") is wrong: spacing is `--spacing` × n | likely | the comment |
| W12 | knip "unused exports" in the web that are used in their own file (e.g. `SHOWN_METHODS`, `durationText`, `requestsHref`, `behindOf`, `IMAGE_LIMIT`, `AGOROT`, `newRequestKey`, most `*Props` types) | see A8 | certain (keyword only) | low value |
| W13 | `tests/mock-api.mjs`, `audit/reset-db.mjs` | knip lists them unused — **not dead**: `playwright.config.ts:14` and `playwright.audit.config.ts:28` run them | — | keep |

### 2b. Screens and scripts

| # | Thing | Proof | Confidence | Note |
|---|---|---|---|---|
| S1 | `/reports/[kind]` (`features/reports/screens/report-screen.tsx`: providers, tasks, numbers, operations) and the two routes only it calls, `GET /v1/reports/providers`, `GET /v1/reports/operations` | no link to `/reports/providers…` in the web (`git grep -nE "/reports/(providers\|operations\|tasks\|numbers)"` → only the API client); the sidebar links `/reports/balances` and `/reports/supply` only (`app-shell.tsx:279-280`); e2e specs open it by URL | owner's call | a screen reachable by typing the URL only |
| S2 | `/reports`, `/reports/orders`, `/reports/sales` | redirect pages for old URLs (spec 2026-11-09-admin-review, 1) | owner's call | keep while old bookmarks matter |
| S3 | `apps/web/tests/dom-snapshot.mjs` (789 lines) | no npm script runs it; it is the CHK-ZERO check of the superseded `2026-11-13-ui-maintenance` plan; `frontend.md:50` says "it stays in the tree, unused by the Tailwind migration"; `.cursor/rules/verify-before-reply.mdc:34` names it as **not** to be run; l.384 names `styles/doors.css`, deleted in T5.1 | owner's call | `.graphifyignore:9`, `frontend.md:50`, the rule file |

`apps/web/visual-audit/` and `scripts/contrast.mjs` are not in any npm script but are documented tools
(`verify-before-reply.mdc:19`, `DESIGN.md`); not candidates.

---

## 3. Dependencies

| # | Package | Proof | Confidence | Touches |
|---|---|---|---|---|
| D1 | `cookie-parser` (api `dependencies`) | knip "Unused dependencies"; `git grep -n "cookie-parser\|cookieParser" -- apps` → `package.json` and the comment `cookies.ts:9` only; never imported in history (`git log -S"cookieParser" -- apps/api/src/main.ts` empty) | certain | `apps/api/package.json`, `package-lock.json`, A6 |
| D2 | `@types/cookie-parser` (api `devDependencies`) | goes with D1 | certain | same |

Not dead (knip lists some): `@prisma/client` (the generated client imports `@prisma/client/runtime/client` 43 times,
and `monitoring/versions.rules.ts:23` reports its installed version); `tailwindcss` (imported by CSS,
`app/tailwind.css:26-27`); `autoprefixer` (`postcss.config.js:13`). Unlisted: `apps/web/audit/kit.ts` and
`audit/reset-db.mjs` import `pg`, which `apps/web/package.json` does not list (it resolves from the hoisted api
copy) — a missing declaration, not a dead one. Duplicates across workspaces (`typescript`, `eslint`, `@types/node`)
are normal per-workspace tooling at the same versions.

---

## 4. Database leftovers

A scratch script read every model and scalar field of `schema.prisma` and looked for its name in production code of
`apps/api/src` (generated client excluded). Every model is named; every scalar field is named except
`ProviderReconItem.reconciliationId` — the foreign key written through its relation (`reconciliation: { connect … }`
/ nested create), so **not** dead. Name matching cannot prove a column is read *and* written; the database audit
running beside this one is the place for that.

| # | Thing | Proof | Confidence | Touches |
|---|---|---|---|---|
| B1 | The retired task status `pending` (A7) | migrations rewrote the rows; the CHECK refuses new ones | likely | code only, no migration |

Kept on purpose, not dead: `Package.months` and the renewal columns, dual-written with `PackageDuration`
(`catalog/rules/package-prices.ts` `mirroredDuration`) until slice D.10 of the open package-durations plan; the clear
(unsealed) eSIM code read path (codes are sealed by the `seal-secrets` CLI run by hand per deployment, not by a
migration). Migrations are history and are not candidates.

---

## 5. Files and folders

| # | Thing | Proof | Confidence | Note |
|---|---|---|---|---|
| F1 | `docs/architecture/web-components-tree.excalidraw` (10,894 lines), `web-state-dataflow.excalidraw` (2,893), `generate.mjs` | the generator's 104 paths all exist, but 171 web source files are not on the board, among them all of `features/system/` and `app/system/` (M.12, 2026-11-17: `grep -c "features/system" generate.mjs` = 0), and it lists the dead `ui/field.tsx`, `ui/tooltip.tsx`; last regenerated `121a4939` (2026-11-16) | owner's call | regenerate and keep (CLAUDE.md asks for it), or drop the boards and the D5 update rule (`docs/architecture/README.md`, CLAUDE.md "Keep the maps current", spec 2026-11-02-web-architecture-excalidraw-design) |
| F2 | `docs/qa/2026-10-30-content-coverage.md` (68 lines) | `git grep -l content-coverage` → nothing; only `.graphifyignore:3` names `docs/qa/` | certain (nothing points at it) | |
| F3 | `docs/design/current-identity-gaps.md` (422 lines) | its own status: "**closed** (Tailwind migration T6.4, 2026-11-16)"; cited by `DESIGN.md`, `frontend.md`, the Tailwind plan | owner's call | goes with the Tailwind plan; reword the two citations |
| F4 | `docs/architecture/REFACTOR_EXECUTION_REPORT.md` (498), `docs/architecture/2026-11-13-backend-audit-and-office-refactor-plan.md` (480) | the running log and the audit of the office retirement, which is finished (every R box ticked; memory note "finished 2026-11-16"); cited by `README.md` of the folder, `backend.md`, ADR 0020 | owner's call | ADR 0020 keeps the decision; reword its link |
| F5 | `docs/operations/2026-11-12-coolify-upgrade-preparation.md` | "A plan for review: nothing here has been carried out"; l.151 names `node:24` images (now 26) | owner's call | is the upgrade done? If yes, it is history |

Git-ignored local folders (out of scope, listed for size): `apps/web/audit-output/` **3.8 GB** (P1.3's interrupted
patch of the superseded UI plan lives here), `graphify-out/` 101 MB, `design/` 21 MB, `screenshots/` 14 MB,
`apps/api/dist/` 7.5 MB. Not tracked, nothing to commit; the owner may clean them by hand.

Checked, not dead: `docs/brand/*` (the mark behind `app/icon.svg`), `docs/prototypes/2026-11-16-activation-variants.html`
(open package-page plan), `docs/reference/four-layers.html` (`.dockerignore`), `docs/providers/areen.md` (CLAUDE.md),
`scripts/backup/**` (every script named in `docs/operations/backup-and-restore.md` or the handover; `testing/` is "the
cases that must fail", l.30), `apps/web/AGENTS.md` (re-created by `next dev`), `.cursor/skills/` (loaded by Cursor by
convention), `.claude/launch.json`, `docker-compose.override.yml` (dev seed).

---

## 6. Plans and specs

State is read from the boxes (`- [x]` / `- [ ]`), the Status line or table, and the closing notes. Plans without
boxes from 2026-10-30 to 2026-11-05 name files that no longer exist (`office.service.ts`, `office-rules.ts`,
`app/styles/*.css`, `tokens.css`, `office-shell.tsx`): the work was done and the code has since been rewritten —
that state is **inferred** (marked "finished\*"). Precedent: `2026-11-10-open-items.md` was written when finished
plans were last removed (2026-11-10), "they stay in git history".

"Points at it" counts references to the plan's name outside `docs/superpowers/`; most code citations are to the
**spec** of the same name ("spec 2026-11-09-admin-review, 1"), which removing the plan does not break.

| Plan | State | Spec | Points at the plan | Recommendation |
|---|---|---|---|---|
| 2026-10-30-login-room | finished\* | yes | — | remove |
| 2026-10-30-page-tools | finished\* | — | — | remove |
| 2026-10-30-provider-drill | finished\* | yes | — | remove |
| 2026-11-02-api-swagger-mapping | finished (12/12) | yes | `docs/architecture/README.md` | remove; reword README |
| 2026-11-02-empty-state-centering | finished\* | yes | — | remove |
| 2026-11-02-web-architecture-excalidraw | finished (9/9) | yes | `docs/architecture/README.md`, `generate.mjs`, board | remove with F1's decision |
| 2026-11-04-provider-action-defaults | finished (14/14) | yes | — | remove |
| 2026-11-05-activation-result | finished ("Status: done") | yes | — | remove |
| 2026-11-05-activity-log | finished (12/12) | yes | — | remove |
| 2026-11-05-company-sim-settings | finished\* | yes | — | remove |
| 2026-11-05-cursor-lists-pagination | finished\* | yes | — | remove |
| 2026-11-05-esim-provider-cost | finished ("Status: done") | yes | — | remove |
| 2026-11-05-finance-esim-tag | finished\* | yes | — | remove |
| 2026-11-05-full-name-and-profile-address | finished\* | yes | — | remove |
| 2026-11-05-launch-audit | finished\* | yes | `apps/web/playwright.audit.config.ts` (cites the spec) | remove; the spec stays while the audit config cites it |
| 2026-11-05-line-status-suspended | finished\* | yes | — | remove |
| 2026-11-05-notifications | finished (12/12) | yes | — | remove |
| 2026-11-05-package-switch-difference | finished (8/8) | yes | — | remove |
| 2026-11-05-prepaid-periods-refund | finished\* | yes | — | remove |
| 2026-11-05-provider-operations | finished\* | yes | — | remove |
| 2026-11-05-switch-provider-cost | finished\* | yes | — | remove |
| 2026-11-05-topbar-search-beside-wallet | finished\* | yes | — | remove |
| 2026-11-05-user-packages-and-operations | finished ("Done on 2026-11-06") | yes | `pricing/rules/user-terms.ts` (spec) | remove |
| 2026-11-06-service-outage-states | finished (11/11) | yes | — | remove |
| 2026-11-06-terms-followups-and-e2e-repair | finished ("Done") | yes | — | remove |
| 2026-11-07-persistent-office-shell | finished (7/7) | yes | — | remove |
| 2026-11-08-architecture-refactor | finished (67/67; its Status line still says "in progress"); its "After this plan" list is proposals | — | **CLAUDE.md:12** ("Current refactor plan and its status"), `frontend.md:54` | remove after CLAUDE.md row and the frontend heading are reworded |
| 2026-11-08-gap-roadmap | finished (N1–N9 under "Done"); a "Later" list remains | — | `docs/project-plan.md` | keep until "Later" is copied into `open-items` / project-plan, then remove |
| 2026-11-08-improvements-1-3 | finished (4/4) | (sorting-permissions spec) | — | remove |
| 2026-11-08-inner-pages-refresh | finished (5/5) | yes | `stat.tsx`, `tabs.tsx`, a spec (spec) | remove |
| 2026-11-08-overview-and-reports-nav | finished (34/34) | yes | 35 code files (spec) | remove |
| 2026-11-09-admin-review | finished (34/34) | yes | 75 code files (spec) | remove |
| 2026-11-09-graphite-identity | finished (4/4), and its tokens were replaced by the Tailwind migration | yes | 16 code files (spec) | remove |
| 2026-11-09-offers-tasks-addons-wallet-esim | finished (9/9) | yes | 19 code files (spec) | remove |
| 2026-11-10-activation-settlement | **partly done**: S.5 box open (S.5a–c built per open-items), S.12b not started | yes | 4 code files, `backend.md` | **keep** |
| 2026-11-10-auth-activity-and-audit-labels | finished (4/4) | yes | — | remove |
| 2026-11-10-backend-hardening | finished (27/27) | yes | ADR 0010, 0011 | remove |
| 2026-11-10-backend-loose-ends | finished (10/10) | yes | ADR 0015 | remove |
| 2026-11-10-expiry-notice | **not started** (E.1–E.5 open) | yes | — | **keep** (also listed in open-items) |
| 2026-11-10-lists-and-routes | **partly done**: "Not done: the web note when `capped` is true" (l.59; also `backend.md` Known gaps) | yes | ADR 0014 | keep until the capped note is built or moved to open-items |
| 2026-11-10-office-kernel-split | finished (22/22; R.3 later removed the kernel) | yes | ADR 0012 | remove |
| 2026-11-10-open-items | **open backlog** (1/11) | — | `REFACTOR_EXECUTION_REPORT.md` | **keep** |
| 2026-11-10-production-config-and-simulation | finished (5/5); its "Before a deploy" table is the owner's server step, also in `docs/handover/technical-operations-ar.md` | yes | `backend.md:186`, ADR 0016 | remove after `backend.md:186` points at the handover |
| 2026-11-10-provider-dispatcher | **partly done**: D.1–D.12 ticked; "Not started (waits for review)" 1–4 (status check, unknown-operations screen, first adapter, outbox pruning) | yes | `backend.md`, ADR 0018 | keep (or move the four items to open-items, then remove) |
| 2026-11-10-provider-operation-lifecycle | finished (7/7); its "Next phase" was taken up by provider-dispatcher and activation-settlement | yes | ADR 0017 | remove |
| 2026-11-10-session-and-secret-storage | finished (12/12) | yes | ADR 0013 | remove |
| 2026-11-11-two-factor-policy | finished (18/18) | yes | 12 code files (spec) | remove |
| 2026-11-11-ui-consistency-pass | finished (17/17) | yes | 17 code files (spec), `docs/reviews/2026-11-11-visual-audit.md` | remove |
| 2026-11-13-office-retirement | finished (19/19) | — (audit doc F4) | `architecture-boundaries.spec.ts:6` ("Slice R.0 of the plan `2026-11-13-office-retirement`"), ADR 0020, F4 docs | remove after the spec comment is reworded |
| 2026-11-13-ui-maintenance | **superseded** from P1.3 by `2026-11-15-tailwind-radix-migration` (its own Status) | yes | `tests/dom-snapshot.mjs`, ADR 0021, F3 | remove (with S3's decision) |
| 2026-11-15-package-durations-and-deals | **partly done** (D.1–D.3b; D.3c–D.10 open; paused by the owner) | yes | schema, a migration, code (spec) | **keep** |
| 2026-11-15-tailwind-radix-migration | finished: every slice T0.1–T7.1 carries its commit hash; the Status table still says "in progress" | yes | `DESIGN.md`, `verify-before-reply.mdc`, ADR 0021, 0022, F3 | remove after the rule file and DESIGN.md cite ADR 0022 instead |
| 2026-11-16-package-page | **partly done** (P.4 open) | yes | 28 code files (spec) | **keep** |
| 2026-11-17-system-monitor | finished (13/13; M.12 web done) | yes | 42 code files (spec), handover | remove after `technical-operations-ar.md` cites the spec |

Totals: 54 plans — 45 finished or superseded (~6,270 lines), 9 kept (activation-settlement, expiry-notice,
open-items, package-durations, package-page, provider-dispatcher, lists-and-routes, gap-roadmap,
production-config — the last three only until their pointer or leftover is moved).

### 6b. Specs

Specs are the record of the business rules each feature was built to; code cites them by name (admin-review 75
files, system-monitor 42, overview-and-reports-nav 35, package-page 28 …). Recommendation: **keep every spec that
code, a map, an ADR or the handover cites** (37), and the specs of the 9 kept plans. The other **42** are cited by
nothing outside `docs/superpowers/` and their plans are finished: 2026-10-28-login-design,
2026-10-30-inner-desk-design, -login-room, -provider-drill, -route-split, -shell-header, 2026-10-31-locale-first-paint,
2026-11-01-companies-packages-design, 2026-11-02-empty-state-centering, 2026-11-03-task-support-ticket-design,
2026-11-04-provider-action-defaults-design, 2026-11-05-activation-result, -activity-log-design, -company-sim-settings,
-cursor-lists-pagination, -disconnect-refund-design, -esim-provider-cost, -esim-serial-qr-design, -finance-esim-tag,
-finance-report-design, -full-name-and-profile-address, -line-operations-design, -line-status-suspended,
-notifications-design, -package-switch-difference-design, -prepaid-periods-refund, -provider-operations-design,
-refresh-active-only, -site-branding-design, -switch-provider-cost-design, -topbar-search-beside-wallet,
2026-11-06-service-outage-states, -terms-followups-and-e2e-repair, 2026-11-07-page-tab-title,
-persistent-office-shell, 2026-11-08-design-gaps, -full-wallet, -layer-profits, -office-domain-split,
-users-server-paging, -web-structure-design-system, 2026-11-10-auth-activity-and-audit-labels. **Owner's call**:
they may hold the only written reason for a rule (`docs/project-plan.md` holds the business rules by date); removing
them loses nothing from git history.

`docs/reviews/` (2026-11-10 backend review, 2026-11-11 visual audit, 2026-11-13 UI audit) are findings records cited by
rules, ADRs and specs: keep. ADRs are not candidates.

### 6c. Docs that contradict the code today

| # | Where | What it says | What is true |
|---|---|---|---|
| D1 | `CLAUDE.md:12` | the current refactor plan is `2026-11-08-architecture-refactor.md` | that plan is finished; the open plans are the 9 above |
| D2 | `README.md:35` | lint runs `apps/web/scripts/check-css.mjs` against `css-baseline.json` | neither exists; the style check is `check-styles.mjs`, run by `npm run check:styles` |
| D3 | `README.md:52` | `app/` holds `globals.css` | deleted in T5.1; the one sheet is `app/tailwind.css` |
| D4 | `README.md:42` | CI runs lint, typecheck, api tests, build | it also runs `check:copy`, `check:styles`, `next typegen`, and a `db` job (`ci.yml:31-83`) |
| D5 | `backend.md:56` | `platform/query.ts` (`text`) | dead file (A1) |
| D6 | `backend.md:97` | heading "`office` endpoint groups" | `office` is retired (ADR 0020) |
| D7 | `backend.md:99` | `routes.http.spec.ts` lists "all 135" | `testing/routes.ts` has 144 rows |
| D8 | `backend.md:161` | 70 migrations | 74 |
| D9 | `backend.md:173` | task statuses `working`, `done`, `cancelled` | also `rejected` (CHECK in `20261110110000_task_and_entry_keys:26`; `TasksService.reject`) |
| D10 | `backend.md:178,180` | 112 spec files; twelve `*.db.spec.ts` | 155 spec files; 32 `*.db.spec.ts` |
| D11 | `backend.md:194` | provider operations have "no caller" | the activation records and dispatches them (`sales/lines.service.ts`, `activation-dispatch.db.spec.ts`) |
| D12 | `backend.md:208` | "No code reads or writes the S.1 columns and tables yet" | `ProviderDecisionEvent` is written (`provider-operations.repository.ts`), `Task.requestKey` is honoured (S.6), etc. — the Known-gaps paragraph is a history of S.1–S.7 |
| D13 | `frontend.md:54,67-80` | "Known defects" (all struck through) and a "Target shape" with `app/(office)/`, `components/shell/`, `lib/i18n/` | none of the three exists; screens live in `features/*/screens`, copy in `lib/copy` |
| D14 | `DESIGN.md:302,1030` | "Callers today: `Tooltip`, `Sheet end` and `Sheet bottom` … have no caller" | `Field` (and `Sparkline`, said at l.756) have none either |
| D15 | `docs/architecture/2026-11-13-backend-audit-and-office-refactor-plan.md:5` | "Slice R.0 is built. Each later slice still needs the owner's word" | every slice is built and pushed |
| D16 | `plans/2026-11-08-architecture-refactor.md:3`, `plans/2026-11-15-tailwind-radix-migration.md:14-24` | "in progress" | every box / every slice hash is in |
| D17 | `docs/operations/2026-11-12-coolify-upgrade-preparation.md:151` | the images are `node:24-bookworm-slim` | `node:26-bookworm-slim` (`apps/*/Dockerfile`) |
| D18 | `apps/api/src/modules/platform/cookies.ts:9` | "from cookie-parser when it ran" | it never runs (A6, D1 of §3) |
| D19 | `apps/web/app/tailwind.css:155` | "`p-6` = `--rd-space-6`" | spacing is `--spacing` × n; `--rd-space-6` is read by nothing (W11) |
| D20 | `apps/web/tests/dom-snapshot.mjs:384` | `styles/doors.css` | deleted in T5.1 |

---

## 7. Comments and names that outlived their subject

Counts (tracked files; `git grep -cP`):

| Area | Lines | Comment lines | Slice / phase references (`slice R.3`, `migration T4.9`, `M.6` …) | History words (`legacy`, `before it`, `until then`, `no longer`, `moved from`, `(was `) | TODO/FIXME |
|---|---|---|---|---|---|
| `apps/api/src` | 57,108 | 6,535 | 307 | 95 | 0 |
| `apps/web/components` | 8,275 | 1,410 | 91 | 87 | 0 |
| `apps/web/features` | 14,763 | 1,438 | 76 | 54 | 0 (the two hits are a class constant named `TODO`) |
| `apps/web/lib` | 7,729 | 488 | 20 | 7 | 0 |
| `apps/web/app` | 369 | 28 | 26 | 10 | 0 |
| `apps/web/tests` | 6,804 | 506 | 17 | 4 | 0 |

Plus "spec 2026-…" / "plan 2026-…" citations: ~320 across code.

References to files that no longer exist, in the web's comments: `graphite.css` 112, `forms.css` 25,
`responsive.css` 22, `table.css` 16, `shell.css` 7, `globals.css` 3 (all deleted in Tailwind migration T5.1). Sample:
`components/alert.tsx:5` "ported from the legacy forms.css `.error` / `.note` / `.banner`";
`components/app-shell.tsx:103` "(legacy `.nav-link`)"; `features/reports/screens/report-pages.tsx:27-30` explains a
chip by the graphite.css and responsive.css rules it replaced. In the API: `architecture-boundaries.spec.ts:151-210`
explain each rule by the slice that made it (`the cuts of slice R.2 hold …`) — these are test names, harmless.

In the maps: `backend.md:5` (10,237 characters), `:93` (10,414), `:95` (8,032) and `frontend.md:106` (29,164) are
single lines of slice history ("Last verified" and module rows that narrate each slice).

**Proposed rule** (for `.cursor/rules/backend-engineering.mdc` / `smilesim-ui.mdc`, owner's word first):

1. A comment says what the code does now and why — the rule, the constraint, the decision (cite the ADR or the
   spec section that holds the business reason).
2. It does not say what the code used to be, which slice moved it, or which deleted file a value came from. That is
   `git log` / `git blame`'s job.
3. A citation names something that exists: an ADR, a spec, a file in the tree. A citation of a finished plan is
   replaced by its spec or ADR.
4. "Last verified" in a map is one line: the date and what was checked. The slice narrative lives in the commit.

Rewording these comments is wide and cosmetic: it belongs in its own slices, area by area, after the deletions, and
it is behaviour-free (lint, typecheck, check:copy, check:styles, the architecture guards prove it).

---

## Proposed order of removal

Each slice is verified with `npm run lint`, `npm run typecheck`, `npm run check:copy`, `npm run check:styles`, the
architecture guards (`architecture.spec.ts`, `architecture-boundaries.spec.ts`) and the specs of the touched area
(one spec file at a time locally, the full suite on CI), and can be reverted alone. Maps are updated in the same
slice.

1. **API, certain, no behaviour** — A1 (`platform/query.ts`), A2, A3, A4, A5. Map: `backend.md:56`.
2. **Web, certain, no behaviour** — W4 (`LayerSessionRulesPane` + copy keys `sessionRulesHint`, `sessionRulesSaved`
   in ar/en/he), W5, W6, W7, W8 (`posted`), W11 (+ the l.155 comment).
3. **Dependency** (owner's word) — D1 + D2 (`cookie-parser`, `@types/cookie-parser`, lockfile) with A6 and D18.
   CI builds the image.
4. **Docs, rewording only** — 6c D1–D20.
5. **Plans** — remove the 45 finished/superseded plans in one commit (after the pointers in the plans table are
   reworded in slice 4: CLAUDE.md:12, `frontend.md:54`, `architecture-boundaries.spec.ts:6`, `backend.md:186`,
   `verify-before-reply.mdc`, `DESIGN.md`, `technical-operations-ar.md`, `docs/architecture/README.md`).
   Move gap-roadmap's "Later" list and provider-dispatcher's four "Not started" items into `open-items` first if the
   owner wants those plans gone too.
6. **Owner's call, files** — F1 (regenerate or drop the boards), F2, F3, F4, F5; S3 (`dom-snapshot.mjs`); 6b specs.
7. **Owner's call, primitives** — W1 `Sparkline`, W2 `Tooltip`, W3 `Field`, W9 re-exports, W10 sheet sides; update
   `DESIGN.md`'s component table in the same slice.
8. **Behaviour / response shape** (owner's word, own slice each) — A7 (`pending` compatibility; check
   `response-shape.spec.ts` for overview's counts); each route R1–R8 and S1's screen and its two routes.
9. **Optional, cosmetic** — A8 / W12 (drop `export` where only the file uses it); the comment rule (§7), area by area.

Estimated total for slices 1–5: ~45 plan files (~6.3k lines), 1 API file, ~200 lines of code and copy, 2
dependencies. Slices 6–7 add up to 3 web files (163 lines), `dom-snapshot.mjs` (789), the boards (13.8k JSON lines),
~1.5k lines of docs, and up to 42 specs.

---

## Looks dead, is not (do not remove)

| Thing | Why it stays |
|---|---|
| `modules/{auditing,monitoring,reporting}/index.ts` (empty surfaces) | `module-surface` requires an `index.ts` for each of the 13 modules (`architecture-boundaries.spec.ts:131-143`) |
| `@prisma/client` | the generated client's runtime; the versions page reads its installed version |
| `tailwindcss`, `autoprefixer`, `@tailwindcss/postcss` | CSS `@import` and `postcss.config.js` |
| `apps/web/tests/mock-api.mjs`, `apps/web/audit/reset-db.mjs` | run by `playwright.config.ts:14` and `playwright.audit.config.ts:28` |
| `apps/web/AGENTS.md` | written back by `next dev` (its own text) |
| `POST /auth/logout` | `scripts/backup/rehearsal-smoke.mjs:78` |
| `GET /health` | the handover's health checks (`technical-operations-ar.md:56,312`) |
| `GET /v1/system/versions` | called server-side by `app/system/versions/data/route.ts` |
| the `…/export` routes, `GET /v1/notices/stream` | CSV links (`*ExportHref`) and `EventSource` in `lib/use-notices.ts`, not `request()` |
| the five `/v1/providers/:code/dispatch…` routes | the branch screens are S.12b of the open activation-settlement plan |
| `/reports`, `/reports/orders`, `/reports/sales` | redirects for old URLs |
| `Package.months` and the renewal columns | dual-written with `PackageDuration` until D.10 of the open package-durations plan |
| the clear eSIM code read path | codes are sealed by a CLI run per deployment, not by a migration |
| `ProviderReconItem.reconciliationId` | the foreign key, written through the relation |
| action name `reactivate` in the web's names and filters | old ledger and task rows carry it |
| `scripts/backup/testing/*` | the backup's failure and R2 cases (`backup-and-restore.md:30`) |
| `apps/web/scripts/contrast.mjs`, `apps/web/visual-audit/` | documented tools (`DESIGN.md`, `verify-before-reply.mdc`) |
| `.cursor/skills/`, `.claude/launch.json`, `docker-compose.override.yml` | loaded by convention (Cursor, the preview, compose) |
| task notice kinds `task.opened` … `task.cancelled` | written by `` `task.${event}` `` (`tasks.service.ts:436`) |
| the 229 + export-only names | used in their own file; only the keyword is extra |

## Checked and clean

- Error codes: all 66 keys of `ERROR_MESSAGES` appear in production code outside `errors.ts` (loop over the keys,
  `grep -rlw` excluding specs).
- Activity actions: all 74 of `ACTIVITY_ACTIONS` are recorded by production code outside `activity.ts`.
- Notice kinds: all 18 are written (the task kinds dynamically).
- Environment: all 19 `ENV_NAMES` are read outside `config.ts`; every `.env.example` variable is the API's or the
  web's (`NEXT_PUBLIC_API_URL`).
- Providers: every class in a module's `providers` is injected, or bound with `useClass` to a port.
- API test helpers (`**/testing/*.ts`, `*.fixture.ts`): knip, with specs as entries, finds none unimported.
- Web API client: every function of `features/*/api.ts` has a caller except `reactivateLine` and
  `setUserPackagesBulk` (R2, R3).
- CSS: every class selector, `data-slot` and `@utility` of `app/tailwind.css` has markup; every `--rd-*` token but
  `--rd-space-6` is read; every Tailwind theme token maps to a utility the screens use.
- Copy: of 1,293 keys, `posted` is used by no screen (W8); `sessionRulesHint`, `sessionRulesSaved` only by the dead
  pane (W4).
- E2E/audit specs open only routes that exist (`/reports/numbers` etc. resolve through `/reports/[kind]`).

## Not done

- Props never passed were not searched exhaustively (no tool does it reliably for TSX with spreads); only knip's
  unused-type leads were followed.
- Whether a column is read *and* written was not proved (name search only); left to the database audit.
- `git grep` matches by name: a symbol whose name also appears as an unrelated field could hide a dead export; the
  candidates above were each checked by import, not only by name.
