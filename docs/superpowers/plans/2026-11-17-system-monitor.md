# System monitor — plan

Spec: `docs/superpowers/specs/2026-11-17-system-monitor.md`. Approved by the owner on 2026-11-17 (D1–D8 as
proposed). One slice = one commit, ticked with its hash. Per slice: `npm run lint`, `npm run typecheck`,
`npm run check:copy`, the touched spec files, `architecture*.spec.ts`; web slices are checked on the running copy
(port 3000), ar and en, light and dark, every width, per `.cursor/rules/verify-before-reply.mdc`. Each slice
updates `docs/architecture/backend.md` / `frontend.md`, `testing/response-shape.spec.ts`, `testing/routes.ts`,
`testing/permissions.http.spec.ts` and `apps/web/lib/api-types.ts` when a route or a shape is added. Paths are
under `apps/api/src/modules/` unless they start with `apps/` or `prisma/`.

- [x] **M.0 The module.** (`cff5f200`) ADR 0020 amended: `monitoring`, the thirteenth module, depends on `platform`,
  `identity`, `access`, `notifications`, `providers`; nothing depends on it. `architecture-map.fixture.ts`
  (`MODULES`, `OWNERS`, `DEPENDS_ON`), `monitoring/index.ts`, `MonitoringModule` in `registry.ts`. The policy:
  `requireOwner` on every route of the module (D1). No behaviour yet.
- [x] **M.1 The request log is written.** (`7a701a4b`) `prisma/schema.prisma` `RequestLog` (id, at, durationMs, method,
  route, path, status, code, actorId, actorLoginName, operatorId, layer, ip, userAgent, requestId, bytesIn,
  bytesOut; indexes on `at`, `(status, at)`, `(route, at)`, `(actorId, at)`, `(ip, at)`) and its migration.
  `src/request-log.middleware.ts` (composition root, first in `app.module.ts`): sets `X-Request-Id`, on the
  response's end hands one row to `monitoring/request-log.writer.ts` (a buffer flushed every 2 s or 200 rows,
  dropped and counted when the database refuses, flushed on shutdown). The route pattern and the account are read
  from the request after the handlers ran; the path is cut at `?`. Not written: `/health`, the notices stream.
  Specs: no body, cookie, query or header value in a row (a request that carries each); a refused request
  (`401`, `403`, `429`, `404`) is written; a failing database loses rows and fails no request; `http-security-contract.spec.ts`
  pins the middleware's place.
- [x] **M.2 Reading and clearing.** (`8aeb170e`; open: `check:copy` needs `request_log_clear` in `apps/web/components/names.ts` and the audit filter, left for the web) `GET /v1/system/requests` (cursor list; filters `status`, `code`, `route`,
  `account`, `ip`, `slowerThan`, `from`, `to`; through a zod query), `GET /v1/system/requests/summary` (count,
  error rate, five slowest and five most called routes with median and p95, in SQL), `DELETE /v1/system/requests`
  (`@Activity('request_log_clear')`, the count in the record). Specs: owner only (permission matrix), the filters,
  the clearing leaves the activity log and writes its own event.
- [x] **M.3 Web: the section and the request log.** (`109e4159`) `apps/web/components/app-shell.tsx`: the group
  «المطورين والحماية» (branch, owner). `apps/web/features/system/` (api, screens), `app/system/requests/page.tsx`:
  the table on `DataTable` and `FilterBar`, the summary strip, the clear dialog. Copy in the three languages.
- [x] **M.4 Errors.** (API `b31153bf`; web `347e993a`) `RequestError` (requestId, at, route, name, message, stack top; filtered by
  `platform/log.ts`), written by `api-exception.filter.ts` through a port of the platform for a 5xx only.
  `GET /v1/system/errors` (grouped by route and message), `DELETE /v1/system/errors`. Web: `app/system/errors`.
  Spec: no value of the request in a stored message.
- [x] **M.5 Status.** (API `be3ec8f3`; web `379cab04`) `WorkerHeartbeat` (one row a worker, by the database's clock, written every 20 s by
  `src/worker/`) and its migration. `monitoring/status.service.ts`: the nine parts of the spec, each a small
  probe with a time limit of its own, so that a part that hangs shows `متوقف` and the others still answer;
  thresholds in `monitoring/thresholds.ts`. `GET /v1/system/status`. Web: `app/system/page.tsx`, cards, 15 s.
  Specs: each probe's three states on stand-ins; a hanging probe does not hold the answer.
- [x] **M.6 Alerts.** (API `fa15ad8c`; web pending) `Alert` (kind, key, subject fields, count, firstAt, lastAt, state, seenAt, seenBy) with a
  unique open alert a (kind, key), and its migration. `monitoring/alert-rules.ts` (pure: the ten rules over
  counted rows, tested alone), `monitoring/alert-pass.ts` run every 30 s by the worker (`WORKER_MONEY_PATH` is
  not touched: its own small composition). A new alert writes one notice to the branch owner (`system.alert`, a
  new kind in `platform/notices.ts`, its text in the three languages). `GET /v1/system/alerts`, `POST
  /v1/system/alerts/:id/seen`, `DELETE /v1/system/alerts`; the open count in `GET /v1/me` for the owner.
  Specs: each rule opens at its threshold and not under it, closes after 30 quiet minutes, one notice an alert.
- [x] **M.7 Web: alerts.** (`6f02cf71`, `a13f1ace`, `4be8a28d`, `44ae729a`, `618f19ec`; map `354c0e00`) `app/system/alerts/page.tsx`: open and past alerts, each with its link to the request
  rows; the count on the sidebar section; the notice opens the alert.
- [x] **M.8 Retention and handover.** (API `e3cd5c5c`; handover `2d4db8fc`) The worker's daily purge deletes request rows and errors older than 14
  days and closed alerts older than 90. `docs/handover/` (Arabic): what the section shows, what is stored and for
  how long, what the clear button does, what each alert means and what to do. `docs/architecture/backend.md`,
  `frontend.md`, `DESIGN.md` if a new primitive was needed.

**Closing note (2026-11-17).** Every slice, M.0–M.8, is built and committed; nothing of it is deployed yet. Left on
purpose: the worker-down alert raised by the API itself (a stopped worker warns of nothing, itself included; the
status page still shows it), tuning the thresholds after a week on the trial server, alerts outside the app (SMS,
e-mail, WhatsApp wait for the messaging feature), and the Hebrew texts of the section, not yet read by a native
speaker.

## Order and what each slice leaves working

M.0–M.3 give the owner the request log with its button. M.4 adds the crashes. M.5 the status page. M.6–M.7 the
warnings. M.8 the upkeep. Each stops at a usable state; the owner may reorder M.5 before M.4.

## Risks

- **The log slows the system it watches.** The buffer and the batch write are the answer; M.1's spec measures
  that a request does not wait for the write.
- **A secret reaches the table.** Only the listed fields are written, and M.1 and M.4 each carry a spec that
  sends secrets every way a request can carry them and reads the table.
- **Alerts that cry wolf.** The thresholds are first values; M.6 keeps them in one file, and the first week on
  the trial server is for tuning them.

## Second round (spec sections 5 and 6; owner, 2026-11-17)

- [ ] **M.9 A stopped worker is warned of (API).** A timer in the API (monitoring, stopped with the module) reads
  the heartbeat every 30 s and opens `service_down` for `worker` past the `down` limit, through the same repository
  and notice as the pass; the worker's own pass does not open a second one. Specs: opens once with several
  checkers, one notice, closes after the worker is back.
- [ ] **M.10 The server log.** `platform/api-exception.filter.ts` logs `errorReport` and the request id. Spec: a
  crash that carries a secret in its message leaves none in the captured log.
- [ ] **M.11 Versions (API and worker).** `StackVersion` + migration; `monitoring/versions.*`: what is in use on
  the API side, the daily check in the worker (npm registry, endoflife.date; `VERSION_CHECK`; a time limit a
  call; a failed call keeps the last answer), the notice `system.update`, `GET /v1/system/versions`,
  `POST /v1/system/versions/check`. Handover: the new variable, the two hosts the server calls.
- [ ] **M.12 Versions (web) and the Hebrew pass.** `app/system/versions`, the web's own versions read by the web
  server, the sidebar item; the section's Hebrew texts read through and corrected.

