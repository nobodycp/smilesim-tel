# Provider action defaults — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provider-level run-mode defaults stored as a flexible map; provider page Settings + Packages; new packages copy defaults once.

**Architecture:** `Provider.actionModes` JSON; helpers in `office-rules` for normalize + flags-from-modes; GET/PATCH office provider settings; Next provider page tabs reusing package mode select pattern.

**Tech Stack:** NestJS office module, Prisma/PostgreSQL, Next.js App Router, existing Desk / `.steps` / DataTable / `--rd-*` tokens.

**Spec:** `docs/superpowers/specs/2026-11-04-provider-action-defaults-design.md`

## Global Constraints

- Modes: `auto` | `manual` | `off` only; labels from existing copy (`automatic`, `manual`, `stopped`).
- Action catalog: `activate`, `charge`, `extend`, `disconnect`, `freeze`, `switch`, `rename`, `sim`.
- Missing map keys resolve to `manual`; never rewrite existing packages on provider save.
- Colours `--rd-*` only; Arabic chat already covered by existing prefs/copy files (add English keys in ar/en/he).

---

### Task 1: Schema + mode helpers

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`Provider`)
- Create: migration under `apps/api/prisma/migrations/`
- Modify: `apps/api/src/modules/office/office-rules.ts`
- Test: `apps/api/src/modules/office/office-rules` spec or extend `response-shape.spec.ts`

- [x] Add `actionModes Json @default("{}")` on `Provider`
- [x] Export `ACTION_KEYS`, `defaultActionModes()`, `normalizeActionModes(raw)`, `packageFlagsFromModes(modes)` (modes → auto/allow booleans for all eight)
- [x] Unit tests: empty → all manual; partial map fills missing; flags match `flagsForMode`
- [x] Run migrate / generate locally

### Task 2: Provider settings API

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts`
- Modify: `apps/api/src/modules/office/office.controller.ts`
- Modify: DTO file if present for office routes

- [x] `GET /office/providers/:code/settings` → `{ code, name, modes }` (normalized)
- [x] `PATCH /office/providers/:code/settings` body `{ action, mode }` → update map only; 403 non-branch / no edit; 404 unknown provider
- [x] Do not update any `Package` rows in these handlers

### Task 3: Provider page UI

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/copy/{ar,en,he}.ts`
- Modify: `apps/web/app/providers/[code]/page.tsx`

- [x] Client: `providerSettings`, `setProviderMode`
- [x] Copy: settings / packages tab labels (reuse action + mode strings)
- [x] Page: `.steps` tabs Settings | Packages; settings = mode table like package run tab; packages = existing table
- [x] Save calls PATCH; reload settings

### Task 4: Create-time copy hook

**Files:**
- Modify: any existing package-create path if found; otherwise keep helper exported and note in service comment near package writes
- Optional small test that `packageFlagsFromModes(normalizeActionModes(provider.actionModes))` is the create payload shape

- [x] Wire helper in `ensureCatalog` package create; helper exported for any future create API

### Task 5: Verify

- [x] `npm run typecheck:api` and `npm run typecheck:web`
- [x] Browser: provider settings save; existing package modes unchanged; ar smoke

---

### Follow-up (not this plan)

- Per-provider supported operations on/off
- Additional provider settings blocks
- Package-create UI if still missing
