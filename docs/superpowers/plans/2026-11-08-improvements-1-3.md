# Improvements 1–3 — plan

Spec: `docs/superpowers/specs/2026-11-08-sorting-permissions-api-guards.md`. One verified slice at a time; gate per
slice: lint, check:copy, typecheck, test:api, build, e2e.

- [x] I3 API guards: `src/rate-limit.middleware.ts` (Redis window, memory fallback) and `src/security-headers.ts`, wired in `app.module.ts` / `main.ts`; specs. Checked on the built Docker API with Redis: headers on `/health`, the 61st write in a minute answers 429 with `Retry-After: 59`. TBD
- [ ] I2 Permission matrix: route table moved to `testing/office-routes.ts` (shared with `routes.http.spec.ts`); `permissions.http.spec.ts` pins route × account. Findings listed in the spec.
- [ ] I1 Paged tables lose their sort buttons (`DataTable sortable`), e2e. Frontend map, DESIGN.md table rule.
- [ ] Owner decision on the `read` / `accounting` grants → its own slice.
