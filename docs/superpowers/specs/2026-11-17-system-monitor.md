# System monitor: status, request log, early warnings — spec

Owner's request (2026-11-17): a section in the sidebar, «المطورين والحماية», where the branch owner sees the
health of the system and its services, is warned early of a break-in attempt, a cracking attempt or a rate limit
being hit, with the details, and reads a log of every request the system served, with a button that clears it.
The log is there to find slow and failing operations later.

Status: **draft, waiting for the owner's word on D1–D8.** Nothing is built.

## What this is, and what it is not

It **shows and warns**. It does not block. A limit on every route and a lock on an account under attack are the
later security pass (`2026-11-10-open-items.md`, "After the business logic"); when that pass is built, what it
refuses appears here with no further work, because this section reads what the system already refused.

It is not the activity log («سجل النشاط»). That one is the business record: who did what to which account, line
or wallet, kept 90 days, read by every layer. This one is technical: every HTTP request, whoever sent it, kept for
days, read by the branch owner only.

## The section

«المطورين والحماية» in the desk's sidebar, the branch door only, the branch owner only (D1). Four pages:

| Page | Route | What it answers |
|---|---|---|
| حالة النظام | `/system` | Is every part working right now? |
| الإنذارات | `/system/alerts` | Is someone attacking, or is something breaking? |
| سجل الطلبات | `/system/requests` | What did the system serve, how fast, and what failed? |
| الأخطاء | `/system/errors` | Which requests crashed (5xx), and where in the code? |

The sidebar item of the section carries a count: the alerts that are open.

## 1. System status (`/system`)

One card a part, each `سليم` / `تحذير` / `متوقف`, with the figure that says why. Refreshed every 15 s while the
page is open; nothing is stored.

| Part | Read from | Warn | Down |
|---|---|---|---|
| API | the process: uptime, version (commit), memory | memory over 80 % of its limit | — (it answers, or the page shows the outage) |
| Worker | a heartbeat row the worker writes every 20 s (new) | none for 60 s | none for 3 min |
| PostgreSQL | `SELECT 1` timed; open connections; database size | ping over 200 ms | no answer |
| Redis | `PING` timed; used memory | ping over 100 ms | no answer |
| Queues | BullMQ counts of `provider-operations`, `provider-settlements`: waiting, active, failed | waiting over 100, or any failed | — |
| Outbox | unpublished messages and the age of the oldest | oldest over 1 min | oldest over 10 min |
| Providers | the provider health that exists (`provider-health.service.ts`) | a provider in `problem` | — |
| Requests, last 15 min | the request log: count, error rate, slowest route | 5xx over 1 % | 5xx over 10 % |
| Database schema | applied migrations against the ones the build carries | — | one not applied |

The thresholds are constants in one file, stated in the spec so that they are chosen once (D6).

## 2. Request log (`/system/requests`)

**Every request the API receives is written**, the refused ones and the unknown paths included: the middleware
that writes sits before every other one. Not written: `GET /health` and the notices stream (one endless request a
tab).

One row a request:

| Field | Note |
|---|---|
| time, duration (ms) | when it arrived, how long until the answer ended |
| method, route pattern, path | the pattern (`/v1/lines/:id`) groups; the path as sent, **without its query** |
| status, error code | the HTTP status and the API's refusal code (`LOGIN_REQUIRED`, `RATE_LIMITED`, …) |
| account, layer | the signed-in account by id and login name; an entered session names both accounts |
| address, browser | the caller's IP and the first 200 characters of its user agent |
| request id | a random id, also sent back in the `X-Request-Id` header, so a user's report can be matched to a row |
| sizes | request and response bytes |

**Never written (D3):** a request or response body, a cookie, a header value other than the user agent, a query
string. So no password, code, eSIM code, session or balance can reach this table.

The page: the rows newest first, paged by cursor like every list; filters by status (2xx / 4xx / 5xx / one code),
route, account, address, "slower than", and a time range; a strip above with, for the range shown, the request
count, the error rate, and the five slowest and the five most called routes (median and 95th percentile).

**Writing costs the request nothing:** rows wait in memory and are written in batches (every 2 s or 200 rows). If
the database refuses a batch it is dropped and counted; a request never waits for its log and never fails because
of it.

**Clearing (the owner's button):** «مسح السجل» asks once, then deletes every row. The clearing itself is written
to the activity log (who, when, how many rows), which this button does not touch. Beside it, the log clears itself:
rows older than 14 days are deleted daily by the worker (D2).

## 3. Errors (`/system/errors`)

A request that ends in 5xx keeps, beside its row, the error's class, message and the top of its stack, passed
through the same filter the server log uses (`platform/log.ts`: no values, known codes only). The page groups
them by route and message: how many, first and last seen, and a link to the rows. Cleared with the request log,
or alone.

## 4. Early warnings (`/system/alerts`)

A rule looks at the last minutes of the request log and opens an **alert** when it is passed. An alert says what
happened, where, by whom, how many times, since when, and links to the rows that caused it. It stays **open**
until the owner marks it seen, or 30 minutes pass without the rule being passed again.

| Alert | Rule (first values, D6) |
|---|---|
| Cracking a password | 5 failed sign-ins for one login name in 10 min; or the account reached the system's own limit (10 in 15 min) |
| One address trying many accounts | failed sign-ins for 5 different login names from one address in 10 min |
| Second-step guessing | 5 wrong codes for one account in 10 min |
| Rate limit hit | any `429`: which limit (sign-in, a session's requests, a session's writes), which route, who |
| Probing | 30 `404` or 30 `401` from one address in 5 min |
| Wrong door or origin | 10 `DOOR_MISMATCH` or cross-origin refusals from one address in 10 min |
| Permission probing | 20 `403` for one account in 10 min |
| The system is failing | 5xx over 5 % of requests in 5 min, or 10 crashes of one route in 5 min |
| A service is down | the worker, PostgreSQL, Redis or the outbox `متوقف` for 2 min |
| Slow | the 95th percentile of all requests over 2 s for 5 min |

The rules run every 30 s in the worker (one place, whatever the number of API copies).

**How the owner hears of it (D4):** a notice in the bell that is there today (`Notice`, live through the stream),
the count on the sidebar section, and the page. One notice an alert, not one a request. SMS, e-mail or WhatsApp
wait for the messaging feature.

## Decisions for the owner

| # | Decision | Proposed |
|---|---|---|
| D1 | Who sees the section | The branch owner only. A grant for staff (`developer`) later, with the staff roles. |
| D2 | How long the request log is kept | 14 days, then deleted daily; and the owner's button at any time. |
| D3 | Bodies | Never stored. Sizes only. Storing a body would put passwords and eSIM codes in a table. |
| D4 | How an alert reaches the owner | The bell's notice, the sidebar count, the page. Nothing outside the app yet. |
| D5 | What «مسح السجل» deletes | Requests and their errors. Alerts have their own «مسح». The clearing is recorded in the activity log. |
| D6 | The thresholds above | As written; constants in one file, changed by a commit, not by a screen. |
| D7 | Reads too | Every request, reads included (the owner asked for every request). About 10× the rows of writes alone. |
| D8 | Where the code lives | A thirteenth module, `monitoring`, above the others (it reads them; none imports it): an amendment to ADR 0020. |

## What it costs

- **Rows.** One a request. A busy trial day is tens of thousands; 14 days of a real office, a few million small
  rows with three indexes. PostgreSQL holds that; the daily deletion keeps it level. If it grows past that, the
  answer is a shorter retention or a table split by day, not a change of design.
- **Privacy.** The table holds addresses and who called what. The branch owner alone reads it, it is cleared on
  his word, and it is listed in the handover's register of what is stored.
- **A clear button is a way to hide tracks.** So the clearing is recorded where the button cannot reach, and the
  alerts keep their own counts.

## Out of scope

Blocking (limits everywhere, the account lock): the security pass. Metrics over months, charts of trends: later,
from this log. Alerts outside the app. The server's own logs (Coolify, Docker): they stay where they are.
