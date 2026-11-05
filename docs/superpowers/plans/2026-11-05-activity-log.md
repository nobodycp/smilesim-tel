# Activity log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/audit` with an append-only activity log of real office actions, visible down the account tree, purged after 90 days.

**Architecture:** `ActivityEvent` rows written best-effort from the office and auth controllers after each catalog outcome. `GET /office/audit` reads that table. The worker deletes rows older than 90 days.

**Tech Stack:** Prisma, NestJS office/auth modules, Next.js audit page.

**Spec:** `docs/superpowers/specs/2026-11-05-activity-log-design.md`

## Global Constraints

- Users cannot update or delete rows. The only delete is the purge job.
- Branch sees every row. Other layers see rows whose actor is themselves or an account under them.
- Unknown-login failures have an empty `actorId` and are branch-only.
- A failed insert does not change the action outcome.
- Route stays `/audit`. Nav label becomes the activity log.

---

### Task 1: Table and pure rules

**Files:** `schema.prisma`, migration, `apps/api/src/modules/office/activity-log.ts`, `activity-log.spec.ts`

- [x] Model `ActivityEvent` and user relation
- [x] `clampActivityRange`, `purgeBefore`, `activityVisibility`
- [x] Unit tests for the 90-day clamp, purge cutoff, and branch vs agent visibility

### Task 2: Write and read API

**Files:** `activity-recorder.ts`, office controller `run`, auth controller, `office.service.ts` `audit`, `worker.ts`

- [x] Best-effort recorder from session or login name
- [x] Catalog routes pass an action draft into `run`
- [x] Auth records `login`, `password`, `logout`, `two_factor`
- [x] `audit` lists `ActivityEvent` with filters
- [x] Worker purges on start and every 24 hours

### Task 3: Screen

**Files:** `apps/web/app/audit/page.tsx`, copy, `names.ts`, `api.ts`, audit playwright strings

- [x] Filters and columns from the spec
- [x] Result badge with a text label
- [x] Nav title “سجل النشاط”

### Task 4: Verify

- [x] `office` unit tests and `typecheck:api` / `typecheck:web`
