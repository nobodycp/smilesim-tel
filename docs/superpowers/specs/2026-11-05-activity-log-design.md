# Activity log

## Goal

Replace the current audit feed with one append-only activity log. Every real action in the office is one row: login, accounts, money, line operations, tasks, and settings. Each layer reads its own rows and the rows of accounts under it. The branch reads every row. Rows older than 90 days are deleted by the system.

## Decisions

### Storage

- New table `ActivityEvent`. Users have no update or delete API.
- The only delete is a daily worker job: hard-delete rows whose `at` is older than 90 days.
- That job does not touch wallets, tasks, lines, sessions, or packages.
- A missed day catches up on the next run. Nothing is archived.

### Row

| Field | Meaning |
| --- | --- |
| `id` | Stable id |
| `at` | Time of the event |
| `actorId` | Account that acted. Empty when the login name does not exist |
| `actorLogin` | Login name as typed or as it was at that moment |
| `actorLayer` | `branch`, `main_agent`, `agent`, or `pos`. Empty when `actorId` is empty |
| `action` | Stable key from the catalog below |
| `result` | `ok` or `fail` |
| `reason` | Empty on success. On failure, the API error code (for example `FORBIDDEN`) |
| `ip` | Client address, empty when the server has none |
| `subjectKind` | Empty, or `account`, `line`, `package`, `provider`, `task` |
| `subjectRef` | Login, msisdn, package code, provider code, or task id |

Opening a page is not an event. A new action later is a new `action` key. The table shape does not change.

### Catalog (this slice)

- Session: `login`, `logout` (the account holder revokes a session), `password`, `two_factor`
- Account: `user_create`, `user_freeze`, `user_restore`, `user_delete`, `access`, `enter`, `leave`
- Money: `fund`
- Line: `activate`, `charge`, `extend`, `reactivate`, `disconnect`, `freeze`, `unfreeze`, `switch`, `rename`, `sim`
- Task: `task_take`, `task_release`, `task_note`, `task_complete`, `task_reject`, `task_cancel`
- Settings: `provider_mode`, `package_mode`, `package_price`, `package_chain`, `offer`

Each of these writes one row after the outcome is known, including a rejected attempt. A failure to insert the row is recorded in the server log and does not change the outcome already returned to the caller.

### Who sees a row

- Branch sees every row.
- Any other layer sees a row only when `actorId` is that account or an account under it. The rule is the same tree already used for office visibility.
- A failed login for an unknown name has an empty `actorId`. Only the branch sees that row.

### Screen

- The nav item that is “سجل التدقيق” today becomes “سجل النشاط”. The route stays `/audit`.
- The page is a filter bar and a table, newest first.
- Filters apply as they change: action, result (`ok` / `fail` / all), layer (limited to layers the viewer can see), text match on login or subject, and a from/to date. A date outside the last 90 days is clamped into that window.
- Columns: time, layer, account, action, result, reason, subject, IP.
- Result is a badge with the words success or failure.
- No row menu, no edit, no delete.
- Provider, consumption, funding, task, number, and operation reports stay as they are.

## Non-goals

- Export, archive, or a second database for the log.
- Recording page views.
- Changing money, task, or line behaviour aside from writing the row.
- A new reports catalogue.

## Success

- A failed login and a successful line action each appear as a row with result and, on failure, a reason.
- An agent sees its row and a point-of-sale row under it, and does not see another agent’s row or an unknown-login row.
- The branch sees those rows.
- A row dated 91 days ago is gone after the purge job. A row dated today remains. Wallet rows are untouched.
