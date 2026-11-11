# Two-step verification policy — plan

Spec: `docs/superpowers/specs/2026-11-11-two-factor-policy.md`. Local commits only; lint, check:copy, typecheck and the
auth jest specs run locally, e2e on GitHub Actions.

## Slice 1 — API

- [x] `prisma/schema.prisma` + migration `20261111100000_two_factor_policy` — `LayerPolicy.method`,
      `User.twoFactorRequired`, `User.requiredMethod`.
- [x] `decide-login.ts` — `twoFactorRequired` joins the required test; `mustEnrol()`; `two-factor-policy.ts` (`fixedMethod`, `endUnenrolledSessions`, `settingsView`).
- [x] `auth.store.ts`, `prisma-auth.store.ts`, `testing/memory-auth.store.ts` — layer method, `unenrolledUsers`.
- [x] `auth.schemas.ts`, `auth.service.ts`, `two-factor-policy.service.ts`, `auth.controller.ts`, `errors.ts` — endpoints
      above, enrolment refusal, session ending.
- [x] Specs: `decide-login.spec.ts`, `two-factor-policy.http.spec.ts` (new), store spec rows.

## Slice 2 — Web

- [x] `lib/api.ts`, `lib/api-types.ts`, copy (ar/en/he).
- [x] `features/auth/two-factor-policy.tsx` — the shared control (mode seg + method list).
- [x] `features/roles/screens/roles-screen.tsx` — the layer block.
- [x] `features/accounts/user-settings.tsx` — the redrawn account block.
- [x] `features/auth/sign-in-methods.tsx`, `two-factor-screen.tsx` — only the allowed methods.
- [x] `graphite.css`, `DESIGN.md`.

## Slice 3 — Check and docs

- [x] Click every state at 390 / 768 / 1280, ar-dark and en-light (he for copy: not looked at), per `verify-before-reply.mdc`. e2e `session-rules.spec.ts` updated, not run locally.
- [x] `docs/architecture/{backend,frontend}.md`, "Last verified", e2e specs that read the old pane text.
