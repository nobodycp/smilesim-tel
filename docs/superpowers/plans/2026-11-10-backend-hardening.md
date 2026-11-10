# Backend hardening — plan

Spec: `docs/superpowers/specs/2026-11-10-backend-hardening.md`. One verified slice at a time; tick each with its
commit. Local checks per slice: `npm run lint`, `npm run typecheck`, the touched spec files, `architecture.spec.ts`.

## Phase 0 — Rules

- [x] **0.1** (b6551c6) `.cursor/rules/backend-engineering.mdc`; `apps/api/src/architecture.spec.ts` + baseline; ESLint
  `max-lines-per-function` 80 / `max-lines` 600 with a shrinking exception list; this spec and plan.

## Phase 1 — Money and line state (M1–M14)

- [x] **1.1 Line lock and guarded status** (a3f63b6) (M1–M4). `lines/line-state.ts`: `lockLine`, `expectStatus`. Used first
  thing in every line transaction of `lines.service.ts` (immediate ops and `completeTask`). Specs:
  `lines/line-state.spec.ts` (double disconnect task, stale freeze task, charge on an active line, extend on a
  disconnected line).
- [x] **1.2 One open task per line + action** (a3f63b6; in code under the line lock, no partial index — ADR 0010) (M1). `tasks.service.ts` `openTask`; error `TASK_ALREADY_OPEN`;
  migration: partial unique index.
- [x] **1.3 Frozen staff tasks** (a3f63b6) (M5). `accounts.service.ts` `setFrozen`; migration `pending` → `working`.
- [x] **1.4 Task unit price** (a3f63b6) (M6). `OfficeTask.unitPrice`; `openTask` callers; `completeTask`.
- [x] **1.5 Wallet lock order** (a3f63b6) (M9). `kernel` `lockWallets`; `fund`, `deduct`.
- [x] **1.6 ICCID** (a3f63b6, f482ca2; advisory lock, no partial index) (M8). `SIM_TAKEN`; partial unique index; activate, swap, task completion.
- [x] **1.7 Transaction reads** (a3f63b6) (M10) and provider cost snapshot (M11).
- [x] **1.8 Schema** (a3f63b6; foreign keys and CHECKs; statuses stay `String`, not enums) (M14): foreign keys, `held >= 0`, status checks.

## Phase 2 — Authorization (S1–S3, S5, S7, S11)

- [x] **2.1** (bb4ddc7) `enter()` targets; `/auth` writes need an account session; operator on the session row.
- [x] **2.2** (bb4ddc7) `GET /office/packages` by layer.
- [x] **2.3** (bb4ddc7) Password reset rule + session revocation; staff delete/create/image grants.

## Phase 3 — Contract (A2–A6, A11)

- [x] **3.1** (ef0bc49) Global exception filter, body normalisation, P2002/P2025 mapping, conflict → 409.
- [x] **3.2** (42a1c1b) zod schemas for every body route; `hand-parsed-input` and `untyped-body` to 0.
- [x] **3.3** (42a1c1b; the auth duplicates were hardened, not removed: specs use them. `session-rules` and `contact` are not logged yet — they need new action names and web labels) `@Activity` on every write; auth owner routes recorded; duplicate auth admin routes delegate.
- [x] **3.4** (2f46a2f) `dayRange()`; `POST /auth/logout`.

## Phase 4 — Provider gateway (A1)

- [x] **4.1** (a3f63b6; ADR 0011) `providers/gateway/provider-gateway.ts` port + simulated gateway; `lines.service.ts` asks it.

## Phase 5 — Structure

- [x] **5.1** (ef0bc49, d2a6c84) Dead code and duplicates (cookies, `Gate`, CSV, `TASK_STATUSES`, unused exports).
- [x] **5.2** (42a1c1b) `config.ts`, Nest `Logger`.
- [x] **5.3** (bb4ddc7; baseline 83 → 0) Policy file; `inline-grant-checks` down.
- [x] **5.4** (a3f63b6, 2f46a2f; the exception list is gone) `completeTask` handlers per action; `runOrQueue`; size exceptions removed.
- [ ] **5.5** Partly (d2a6c84, 66b44bf): rule files moved into `rules/` and their domains, test helpers into `testing/`. **Not done:** the kernel split and one Nest module per domain. Kernel split; rule files into domains; test helpers into `testing/`.
- [x] **5.6** `docs/architecture/backend.md` rewritten from the code.

## Phase 6 — Hardening (S4, S6, S8–S10, S12, M7)

- [x] **6.1** (42a1c1b) TOTP attempt limit and replay; per-IP login limit; `trust proxy`.
- [x] **6.2** (42a1c1b, f482ca2) CSRF: no urlencoded parser, `Origin` check on writes.
- [x] **6.3** (42a1c1b; a boot warning and no code in the production log, not a refusal to start — ADR 0011) `LogSender` refused in production; `COOKIE_SECURE` required in production.
- [x] **6.4** (42a1c1b) Idempotency key bound to method, path and body; passkey user verification; `GETDEL` secrets.

## Left for a later plan

- Kernel split and per-domain Nest modules, a repository layer (5.5).
- Session ids hashed at rest (review S6) and TOTP secrets encrypted (S12).
- Paging and one list envelope (A7), route naming (A8), the two `reports/:kind` generations (A12): with the web app.
- Activity events for `/auth` `session-rules` and `contact` (needs web labels).
- Schema validation of query filters.
- The web's `PackageRow` type still says `number` for the price columns that are now `null` for lower layers.
