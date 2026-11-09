# Backend hardening — plan

Spec: `docs/superpowers/specs/2026-11-10-backend-hardening.md`. One verified slice at a time; tick each with its
commit. Local checks per slice: `npm run lint`, `npm run typecheck`, the touched spec files, `architecture.spec.ts`.

## Phase 0 — Rules

- [ ] **0.1** `.cursor/rules/backend-engineering.mdc`; `apps/api/src/architecture.spec.ts` + baseline; ESLint
  `max-lines-per-function` 80 / `max-lines` 600 with a shrinking exception list; this spec and plan.

## Phase 1 — Money and line state (M1–M14)

- [ ] **1.1 Line lock and guarded status** (M1–M4). `lines/line-state.ts`: `lockLine`, `expectStatus`. Used first
  thing in every line transaction of `lines.service.ts` (immediate ops and `completeTask`). Specs:
  `lines/line-state.spec.ts` (double disconnect task, stale freeze task, charge on an active line, extend on a
  disconnected line).
- [ ] **1.2 One open task per line + action** (M1). `tasks.service.ts` `openTask`; error `TASK_ALREADY_OPEN`;
  migration: partial unique index.
- [ ] **1.3 Frozen staff tasks** (M5). `accounts.service.ts` `setFrozen`; migration `pending` → `working`.
- [ ] **1.4 Task unit price** (M6). `OfficeTask.unitPrice`; `openTask` callers; `completeTask`.
- [ ] **1.5 Wallet lock order** (M9). `kernel` `lockWallets`; `fund`, `deduct`.
- [ ] **1.6 ICCID** (M8). `SIM_TAKEN`; partial unique index; activate, swap, task completion.
- [ ] **1.7 Transaction reads** (M10) and provider cost snapshot (M11).
- [ ] **1.8 Schema** (M14): foreign keys, `held >= 0`, status checks.

## Phase 2 — Authorization (S1–S3, S5, S7, S11)

- [ ] **2.1** `enter()` targets; `/auth` writes need an account session; operator on the session row.
- [ ] **2.2** `GET /office/packages` by layer.
- [ ] **2.3** Password reset rule + session revocation; staff delete/create/image grants.

## Phase 3 — Contract (A2–A6, A11)

- [ ] **3.1** Global exception filter, body normalisation, P2002/P2025 mapping, conflict → 409.
- [ ] **3.2** zod schemas for every body route; `hand-parsed-input` and `untyped-body` to 0.
- [ ] **3.3** `@Activity` on every write; auth owner routes recorded; duplicate auth admin routes delegate.
- [ ] **3.4** `dayRange()`; `POST /auth/logout`.

## Phase 4 — Provider gateway (A1)

- [ ] **4.1** `providers/gateway/provider-gateway.ts` port + simulated gateway; `lines.service.ts` asks it.

## Phase 5 — Structure

- [ ] **5.1** Dead code and duplicates (cookies, `Gate`, CSV, `TASK_STATUSES`, unused exports).
- [ ] **5.2** `config.ts`, Nest `Logger`.
- [ ] **5.3** Policy file; `inline-grant-checks` down.
- [ ] **5.4** `completeTask` handlers per action; `runOrQueue`; size exceptions removed.
- [ ] **5.5** Kernel split; rule files into domains; test helpers into `testing/`.
- [ ] **5.6** `docs/architecture/backend.md` rewritten from the code.

## Phase 6 — Hardening (S4, S6, S8–S10, S12, M7)

- [ ] **6.1** TOTP attempt limit and replay; per-IP login limit; `trust proxy`.
- [ ] **6.2** CSRF: no urlencoded parser, `Origin` check on writes.
- [ ] **6.3** `LogSender` refused in production; `COOKIE_SECURE` required in production.
- [ ] **6.4** Idempotency key bound to method, path and body; passkey user verification; `GETDEL` secrets.
