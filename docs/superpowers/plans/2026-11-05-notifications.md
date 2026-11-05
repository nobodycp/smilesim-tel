# Notifications implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Task reading follows the number's chain; every task, wallet, and announcement event writes a notice inside its transaction and reaches the browser live.

**Architecture:** A pure `taskAudience` module decides who reads, who handles, and who is notified. `NoticeService` writes notices in the caller's transaction and publishes after commit through Redis pub/sub. The API exposes an SSE stream; the shell holds one `EventSource`, a toast, and a `/notices` page.

**Tech Stack:** NestJS, Prisma, ioredis, Next.js, Jest.

## Global Constraints

- The actor never receives a notice for their own action.
- Handlers = branch owner + branch users with the `tasks` grant. The grant label becomes "handling tasks".
- Notice text is built in the browser from `kind` + `payload`. The API stores no sentence.
- A notice is written in the same transaction as the change; publishing happens after commit.
- `href` is the record: `/tasks/<id>`, `/finance`, `/`.
- No new colour, no raw hex; reuse `.shell-panel`, `.shell-item`, `.unread`, `.badge`, workbench layout.

---

### Task 1: Task reading rule

**Files:**
- Create: `apps/api/src/modules/office/task-access.ts`
- Test: `apps/api/src/modules/office/task-access.spec.ts`
- Modify: `apps/api/src/modules/office/office.service.ts` (`home`, `tasks`, `task`, `addTaskNote`)
- Modify: `apps/web/lib/copy/{ar,en,he}.ts` (grant label)

- [x] `taskReaders(task, accounts)` returns the user ids that may read: submitter, pos, chain above pos, every branch user. `canHandle(actor)` is owner or `tasks` grant on a branch layer. `taskWhereFor(actor, accounts)` returns the Prisma `where` that lists readable tasks.
- [x] `tasks`, `task`, and `home` use the reading rule. `canTake`/`canWork`/`canNote` follow `canHandle` or readability.
- [x] `addTaskNote` accepts any reader while the task is open.
- [x] Tests: a pos reads a task an agent opened on its number; an agent reads its pos tasks; a branch user without the grant reads everything and cannot take; a sibling pos reads nothing.

### Task 2: Notice record and writer

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`Notice`: `payload`, `actorId`, `actorName`, drop `action`/`msisdn`/`refId`)
- Create: `apps/api/prisma/migrations/<stamp>_notice_payload/migration.sql` (add columns, backfill, drop)
- Create: `apps/api/src/modules/office/notice.service.ts` (`write(tx, userIds, notice)`, `publish(userIds, notice)`, Redis pub/sub, `subscribe(userId)`)
- Create: `apps/api/src/modules/office/notice-kinds.ts` (kind union, payload types, `hrefFor`)
- Test: `apps/api/src/modules/office/notice.service.spec.ts`

- [x] Payload types per kind as in the spec table. `write` dedupes user ids and removes the actor.
- [x] Migration maps `task` → `task.opened`, `task_reply` → `task.done`, payload `{ action, msisdn, taskId }`, `href` `/tasks/<refId>`.

### Task 3: Emit events

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` (`openTask`, `takeTask`, `releaseTask`, `addTaskNote`, `completeTask`, `rejectTask`, `cancelTask`, `fund`, `move`, `postAnnouncement`)
- Modify: `apps/api/src/modules/office/task-access.ts` (`taskAudience(kind, task, actor, accounts, handlers)`)
- Test: `apps/api/src/modules/office/task-access.spec.ts`

- [x] Each event writes inside its transaction and publishes after commit, with the audience from the spec table.
- [x] `wallet.negative` when `balance >= 0` before and `< 0` after. `wallet.ceiling` on `BALANCE_CEILING` refusal, written outside the failed transaction.

### Task 4: Stream and list API

**Files:**
- Modify: `apps/api/src/modules/office/office.controller.ts` (`GET /office/notices/stream`, `GET /office/notices?cursor&group&unread`)
- Modify: `apps/api/src/modules/office/office.service.ts` (`notices` with cursor, group, unread)
- Modify: `apps/web/lib/api.ts` (`NoticeRow` with `kind`, `payload`, `actorName`)

- [x] SSE with session cookie auth, heartbeat every 25s, `event: notice` carrying the notice view; the browser counts unread itself and resyncs on open and every 60s.
- [x] List paginates with the existing feed cursor, page 40.

### Task 5: Shell and `/notices` page

**Files:**
- Modify: `apps/web/components/office-shell.tsx` (EventSource, reconnect, 60s fallback, toast, title prefix, panel of 10, mark all, link)
- Create: `apps/web/lib/notice-text.ts` (`noticeTitle`, `noticeDetail` from kind + payload + copy)
- Create: `apps/web/app/notices/page.tsx`
- Modify: `apps/web/lib/copy/{ar,en,he}.ts`, `apps/web/app/styles/shell.css` (toast)
- Modify: `apps/web/components/office-shell.tsx` nav groups (entry under Tasks); Create: `apps/web/lib/use-notices.ts` (EventSource, reconnect, poll, title)

- [x] Browser check: ar/en, light/dark, 1440 and narrow.

### Task 6: Verify

- [x] `npm run typecheck:api`, `npm run typecheck:web`, API jest, web Playwright for shell.
