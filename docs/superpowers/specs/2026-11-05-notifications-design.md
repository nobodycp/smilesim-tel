# Notifications

## Goal

A notice reaches the people a change concerns, the moment it happens, with enough detail to act and a link to the exact record. Today a notice exists only for a manual task being opened and for its final reply, it goes to every branch user, it carries no result or amount, it links to the task list rather than the task, and the browser learns about it on a 20-second poll.

This spec also fixes who may read a task. Today the `tasks` grant is a reading gate: a branch user without it sees no task, and anyone outside the branch sees only tasks they submitted. A point of sale does not see a task its agent opened on its own number, and an agent does not see the tasks of its points of sale.

## Decisions

### Task reading follows the number, not a grant

- A task is readable by its submitter, by the point of sale that owns the number (`posId`), by every account above that point of sale in its chain, and by every branch user. This is the same rule that decides who sees a number (`visibleAccountIds`). No grant is involved.
- Handling a task (take, release, complete, reject) stays with the branch owner and branch users holding the `tasks` grant. The grant code stays `tasks`; its label becomes "handling tasks" in every language.
- A note may be added by anyone who can read the task while it is `pending` or `working`. A task is a conversation between the chain and the branch.
- Cancelling stays with the submitter.
- Task lists, the task detail page, and the home pending-task count apply the reading rule. A branch user without the handling grant sees every task and has no take, complete, or reject control.

### Events and audiences

The actor never receives a notice for their own action. "Handlers" are the branch owner plus branch users with the `tasks` grant. "Chain side" of a task is its submitter and the point of sale that owns the number, deduplicated.

| Kind | When | Audience | Payload |
|---|---|---|---|
| `task.opened` | a manual task is created | handlers | action, msisdn, package, amount |
| `task.taken` | a handler takes it | chain side | action, msisdn, handler name |
| `task.released` | a handler returns it to the queue | handlers | action, msisdn |
| `task.note` | a note is added | if the author is a handler: chain side; otherwise the current assignee, or handlers when unassigned | action, msisdn, author name, note excerpt (first 120 characters) |
| `task.done` | marked done | chain side | action, msisdn, package, posted amount, handler name |
| `task.rejected` | rejected | chain side | action, msisdn, reason |
| `task.cancelled` | cancelled by its submitter | assignee when there is one, else handlers | action, msisdn |
| `fund.received` | a wallet is funded by another account | the funded account | amount, sender name, note |
| `wallet.negative` | a debit takes a wallet from zero or above to below zero | the account and its parent | balance after, ceiling |
| `wallet.ceiling` | a debit is refused with `BALANCE_CEILING` | the account and its parent | attempted amount, balance, ceiling |
| `announcement` | an announcement is posted | every account under the author in its chain | author name, body excerpt (first 120 characters) |

Support replies are task notes; there is no separate support kind. Line operations (activate, charge, extend, switch, disconnect, freeze, rename, sim, transfer) do not create a notice. A `self_fund` does not create a notice.

### Notice record

`Notice` keeps `id`, `userId`, `kind`, `readAt`, `createdAt`, and adds `payload Json`, `actorId String?`, `actorName String`, `href`. The old columns `action`, `msisdn`, and `refId` move into `payload`. Existing rows are migrated: `task` becomes `task.opened` and `task_reply` becomes `task.done`, each with `{ action, msisdn, taskId: refId }` and `href` `/tasks/<refId>`.

`href` is the record itself: `/tasks/<id>` for task kinds, `/finance` for wallet kinds, `/` for announcements.

The text a user sees is built in the browser from `kind` and `payload`, so it follows the user's language. The API never stores a sentence.

A notice is written inside the same database transaction as the change it describes. Publishing to the live channel happens after that transaction commits. A notice is never written for a change that rolled back.

### Delivery

- `GET /office/notices/stream` is a server-sent events stream for the signed-in user. It authenticates with the existing session cookie. Each event carries the new notice and the unread count. A heartbeat comment goes out every 25 seconds.
- Publication goes through Redis pub/sub on channel `notice:<userId>`, so more than one API instance delivers to whichever one holds the browser's stream.
- The browser opens one `EventSource` in the office shell. On an event it raises the badge, prepends to the panel, and shows a toast for 4 seconds in the app's own style. On close it reconnects with backoff (1s, 2s, 4s, up to 30s) and falls back to a 60-second poll while disconnected. The tab title is prefixed with the unread count.

### Screens

- The bell shows the unread count and a panel with the latest ten notices, a "mark all read" action, and a link to `/notices`.
- `/notices` lists every notice of the user, newest first, with a cursor page of 40, filters for kind group (tasks, wallet, announcements) and read state, and a per-row open action that marks it read and navigates to `href`. The route follows the workbench layout: `.filter-bar` above a `.pane` whose `.sheet` scrolls.
- A notice row shows a title, a detail line (number, package, amount, who), and the relative time. Unread rows carry the existing `unread` treatment.
- `POST /office/notices/read` keeps its shape: with `id` it marks one, without `id` it marks all.

## Non-goals

- Web Push, email, SMS.
- Per-user notification preferences or muting.
- Package expiry warnings and other line-event notices.
- Retention or purge of old notices.
- Changing who may cancel a task or who may run a line operation.
