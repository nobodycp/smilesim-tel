# Session rules per layer and per account

Date: 2026-11-08 · Status: done · Owner: «عدد الجلسات المسموح ووقت انتهاء الجلسة، على مستوى الطبقة وعلى مستوى المستخدم؛ الافتراضي ست ساعات، بعدها يطلع إلا إذا صار عليه حركة»

## Today

Three full sessions per account (`SESSION_LIMIT`), the oldest closed when a fourth signs in. A session lives 30 days
from its last request (`SESSION_TTL_SECONDS`, sliding).

## Rules

- Two values: **sessions allowed** (1–10) and **idle time** (15 minutes – 30 days): how long a session lives after its
  last request. Every request slides it again, so an account in use is never signed out.
- Defaults: 3 sessions, **6 hours** idle (was 30 days).
- Each layer (branch, main agent, agent, point of sale) may set either value; empty follows the default.
- Each account may set either value; empty follows its layer. Account beats layer beats default.
- Only the branch owner reads and changes them (the same rule as the two-factor policy).
- A lower idle time applies at the session's next request: a session idle longer than the new value is closed then.
  A lower session count applies at the next sign-in (the oldest beyond the count are closed), not to sessions already
  open.
- An "enter account" session follows the entered account's idle time.
- The cookie keeps a long life (30 days); the server decides when a session ends.

## Where

- API: `GET /auth/session-rules` (defaults + each layer), `PATCH /auth/session-rules/:layer`,
  `GET|PATCH /auth/users/:loginName/session-rules` (the account's own values, its layer's and the result).
  Values: `{ maxSessions: number | null, sessionMinutes: number | null }`; null follows the next level.
- Data: `LayerPolicy.maxSessions`, `LayerPolicy.sessionMinutes`, `User.maxSessions`, `User.sessionMinutes` (all nullable).
- Web: settings, branch owner only — «الجلسات حسب الطبقة» (one row per layer). User page row menu, branch owner only —
  «الجلسات» dialog for that account.

## Checked

`auth/session-rules.http.spec.ts` (default 3 / 6 h; layer and account levels; null follows the next level; a lowered
idle time closes an idle session, activity keeps it open; owner only; ranges), the updated store and account specs,
`tests/session-rules.spec.ts` (settings rows, hidden for others, the user page dialog). On Docker: a new pos session
lived 21600 s; the pos layer set to 1 session / 30 min gave the next session 1800 s and closed the first; an account
value of 2 / 12 h moved the live session to 43200 s at its next request; everything was reset afterwards.
