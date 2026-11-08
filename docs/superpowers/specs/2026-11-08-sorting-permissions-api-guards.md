# Improvements 1–3: honest sorting, a permission matrix, API guards

Date: 2026-11-08 · Status: approved by owner (improvements 1, 2, 3) · Plan: `docs/superpowers/plans/2026-11-08-improvements-1-3.md`

## 1. Sorting on server-paged tables

**Problem.** `PagedTable` hands `DataTable` only the rows of the page on screen, and `DataTable` sorts what it is given.
A click on a column header of numbers, tasks, users, audit, finance, operations, provider operations, notices or a
report reorders the 10–20 visible rows and says nothing about the rest; the arrow in the header suggests the whole
list is sorted.

**Change.** A server-paged table shows its rows in the order the server pages them (newest first, or layer then
login for users). Its headers are plain text: no sort button, no arrow, no `aria-sort`. `DataTable` takes
`sortable={false}`; `PagedTable` always passes it. Client-side sorting stays on full lists (`DataTable` with every
row in hand), where it is correct. Sorting a paged list by the server is a later feature per list, if asked for.

## 2. Permission matrix

**Problem.** Refusals are tested domain by domain; nothing checks every route against every kind of account, which is
how `PATCH packages/:code/mode` stayed open until Phase 3.

**Change.** `permissions.http.spec.ts` calls every office route as six accounts — branch owner, branch staff with no
grant, branch staff with every grant, main agent, agent, point of sale (default layer grants) — over tables that
hold only the caller, and pins the answer: `403` where the route refuses that account before it reads anything,
otherwise "passes the gate" (any status but 401/403/500). A route that looks the target up before judging the
caller answers 404/400 for everyone here; those rows are marked and stay covered by their domain spec.

**Found while building it — owner decision 2026-11-08: left as is, documented in ADR 0006 until the staff roles (employees, accountants, sales representatives, technicians) are defined:** the `read` and `accounting` grants are
not checked anywhere in the API. A branch staff member with no grant can fund any account from their own wallet
(the branch wallet has no ceiling), change ceilings, and read finance, wallets, users and the audit log. The matrix
pins today's answers for those rows with a comment pointing here, so the fix shows up as a deliberate change.

## 3. API guards

- **Rate limit.** A request that carries a session cookie counts against that session (key: SHA-256 of the session
  id) in a one-minute window shared through Redis: 600 requests, of which 60 may be writes (POST/PUT/PATCH/DELETE).
  Over the limit: `429 { code: 'RATE_LIMITED' }` (already translated) with `Retry-After`. The notices stream and
  `/health` are not counted. Requests without a session are not counted here: the login has its own failure counter.
  Without `REDIS_URL` (specs, local runs) the window lives in memory.
- **Security headers** on every API answer: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` (not on the
  Swagger page `/docs`), `Strict-Transport-Security` in production; `X-Powered-By` removed. A small middleware, no
  new dependency.

## Checks

Item 1: e2e — a paged table has no sort buttons, a full table keeps them. Item 2: the matrix spec. Item 3:
`rate-limit.spec.ts` (window, writes, reset, stream excluded), `security-headers.spec.ts`; DOM of the 30 snapshot pages
unchanged except the headers of paged tables.
