# Duplicate writes are refused on the server (roadmap N1)

Date: 2026-11-08 · Status: done · Owner decision: `docs/project-plan.md` → 2026-11-08

The web page already ignores a second click while a write is in flight (`useAction`). The server now guards too, for
two tabs, a resent request, a slow network or a script.

- `DuplicateGuardInterceptor` (`modules/shared/duplicate-guard.interceptor.ts`), global (`APP_INTERCEPTOR` in
  `OfficeModule`), on every `POST/PUT/PATCH/DELETE` under `/office/` that carries a session.
- Two writes are the same when they come from the same session with the same method, URL and body (10 seconds), or
  carry the same `Idempotency-Key` header (24 hours).
- While the first runs, the same write answers `409 DUPLICATE_REQUEST` («الطلب نفسه قيد التنفيذ»). After it succeeded,
  the same write within the window gets the first answer and runs nothing. A failure leaves no trace, so it can be
  sent again. A handler that writes its own response (enter, leave: they set cookies) is only locked while it runs.
- Redis holds the keys (SHA-256 of the session and the request; never the session id); memory without `REDIS_URL`.

Consequence: an identical write repeated on purpose within 10 seconds (the same amount to the same account) is the
first one, not a second. Checks: `duplicate-guard.interceptor.spec.ts`.
