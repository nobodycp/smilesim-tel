# Task support ticket (Slice A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full-page `/tasks/[id]` ticket with notes timeline; list links into it; money rules unchanged.

**Architecture:** Prisma `OfficeTaskNote` + `GET/POST` office task detail/notes; Next.js detail page mirrors `numbers/[id]` Desk/pane patterns; list drops inline complete/reject.

**Tech Stack:** NestJS office module, Prisma/PostgreSQL, Next.js App Router, existing Badge/Button/`Money`/`latinWhen`.

**Spec:** `docs/superpowers/specs/2026-11-03-task-support-ticket-design.md`

---

### Task 1: Prisma OfficeTaskNote

**Files:** `apps/api/prisma/schema.prisma`, new migration under `apps/api/prisma/migrations/`

- [ ] Add `OfficeTaskNote` model and User/OfficeTask relations
- [ ] Add SQL migration
- [ ] Run generate / migrate for local DB

### Task 2: API detail + notes

**Files:** `apps/api/src/modules/office/office.service.ts`, `office.controller.ts`, `office.dto.ts`

- [ ] `GET /office/tasks/:id` with visibility + `events`
- [ ] `POST /office/tasks/:id/notes` for assignee while working
- [ ] DTO + Swagger annotations

### Task 3: Web ticket UI

**Files:** `apps/web/lib/api.ts`, `apps/web/lib/copy/{ar,en,he}.ts`, `apps/web/app/tasks/page.tsx`, `apps/web/app/tasks/[id]/page.tsx`

- [ ] Client methods + types
- [ ] Detail page (facts, timeline, note form, actions)
- [ ] List links; remove list complete/reject inline reason

### Task 4: Verify

- [ ] `npm run typecheck:api` and `npm run typecheck:web`
- [ ] Browser: ticket note without close; timestamps; ar/en × themes

### Follow-up (Slice B — not this plan)

- Agorot migration, disconnect refund + usage-cost (50 agorot), switch POS price difference
