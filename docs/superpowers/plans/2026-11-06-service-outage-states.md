# Service outage states implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unreachable API is named once, the sidebar stays whole, no pane spins forever, and the office recovers by itself when the API answers again.

**Spec:** `docs/superpowers/specs/2026-11-06-service-outage-states.md`

**Architecture:** `lib/api.ts` classifies proxy 5xx as `NETWORK` and reports reachability to a tiny store in `lib/connection.ts`. `OfficeSession` owns the session retry loop and a `failed` flag. `OfficeShell` renders an `OutagePanel` instead of pages while the session is down, and an `.outage-bar` when the connection drops mid-session. `LoadFailed` replaces skeletons and empty sentences in panes, wired through `DataTable` / `PagedTable`.

## Global Constraints

- Colours from `--rd-*` tokens only; reuse `.empty.empty-state`, `.return-bar` shape, `.btn`.
- Copy keys exist in `ar`, `en`, `he` and are used (`npm run check:copy`).
- The "not ready" nav group is untouched.
- Verify in the browser with the API down, then up, on `admin.localhost` and `main.localhost`, ar and en, light and dark, 1440 and narrow.

---

### Task 1: Reachability

**Files:**
- Create: `apps/web/lib/connection.ts` (`reportReach`, `useConnection`, `onRecover`)
- Modify: `apps/web/lib/api.ts` (classify 502/503/504 and non-JSON 5xx as `NETWORK`; report reach)
- Modify: `apps/web/lib/use-load.ts`, `apps/web/lib/use-paged.ts` (reload on recovery when holding an error)

- [ ] `request()` returns `{ ok: false, status, message: NETWORK_MESSAGE, code: 'NETWORK' }` for 502/503/504 and for a 5xx whose body is not JSON; other answers keep their message.
- [ ] `reportReach(false)` on every `NETWORK` result, `reportReach(true)` on every answer that came from the API; `offline` / `online` window events feed the same store.
- [ ] `useLoad` / `usePaged` call `reload()` when `generation` changes and `error` is set.

### Task 2: Session retry and shell outage states

**Files:**
- Modify: `apps/web/lib/office-session.tsx` (`failed`, `retrying`, `retry()`, backoff 2s→30s, retry on recovery)
- Create: `apps/web/components/outage.tsx` (`OutagePanel`, `OutageBar`)
- Modify: `apps/web/components/office-shell.tsx` (render `OutagePanel` while `failed`; `OutageBar` while ready and unreachable)
- Modify: `apps/web/components/icon.tsx` (`offline` icon)
- Modify: `apps/web/app/styles/desk.css` (`.outage-bar`, `.outage-panel`)
- Modify: `apps/web/lib/copy/{ar,en,he}.ts` (`retry`, `retrying`, `outageTitle`, `outageText`, `loadFailed`)

- [ ] `ready` is true only after `/office/me` succeeds; a failure sets `failed` and schedules the next attempt.
- [ ] Shell: `!ready && !failed` → `PageSkeleton`; `failed` → `OutagePanel`; `ready && !reachable` → `OutageBar` above the page, re-pinging on the same schedule.
- [ ] Sidebar keeps every item during the outage (no shrink after the failure).

### Task 3: Failed state in panes

**Files:**
- Create: `apps/web/components/load-failed.tsx`
- Modify: `apps/web/components/data-table.tsx` (`failed`, `onRetry` on `DataTable`; `PagedTable` wires `list.error` / `list.reload`)
- Modify: `apps/web/app/page.tsx` (stats show `—`, panes show `LoadFailed`)
- Modify: `apps/web/app/numbers/page.tsx` (`ready` from `catalog.loaded`)
- Modify: `apps/web/app/{companies,packages,providers,roles,users}/page.tsx`, `apps/web/app/companies/[code]/page.tsx`, `apps/web/app/companies/[code]/[provider]/page.tsx`, `apps/web/app/providers/[code]/page.tsx` (pass `failed` / `onRetry`)

- [ ] A failed load shows `LoadFailed` inside the pane, never a skeleton and never the empty sentence.
- [ ] Retry re-fetches that pane only.

### Task 4: Verify

- [ ] `npm run lint`, `npm run check:copy`, `npm run typecheck`, `npm run test:api`, `npm run build`.
- [ ] Browser with API down: outage panel, full sidebar, no spinners. Start the API: panel closes, pages load without a reload. Stop it again on a loaded page: bar appears; start it: bar closes and failed panes refill.
- [ ] ar/en, light/dark, 1440 and narrow.
