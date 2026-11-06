# Service outage states

## Goal

When the API is unreachable (process down, proxy returning 5xx, browser offline), the office says so in one place, keeps the sidebar whole, stops every pane from spinning forever, and recovers on its own when the API answers again. A page that fails to load shows a failed state with a retry, not a skeleton and not an empty list.

## Observed today

- The browser never talks to the API directly; Next rewrites `/api/*`. When the API is down Next answers `500 Internal Server Error` as text, so `lib/api.ts` never reaches its `catch` branch and labels the failure `GENERIC` ("حدث خطأ") instead of `NETWORK` ("تعذّر الاتصال بالخادم").
- `OfficeSession` sets `ready = true` whether `/office/me` succeeded or not and never retries. The shell then renders every page with `me = null`.
- `allowed()` in `OfficeShell` shows every nav item before `ready` and hides owner/grant items after it. With `me = null` after a failure, the admin sidebar first paints 17 links and then drops 8 of them (companies, providers, provider reports, provider operations, roles, settings, task/number/operation reports).
- Pages gate their skeleton on `data === null`, so a failed load keeps the skeleton and spinner on screen with no end. Pages that gate on `loaded` show the empty-state sentence ("no lines") for a failure, which reads as "no data".
- No page has a retry control, and there is no `retry` copy key.

## Decisions

### Reachability

- `lib/api.ts` classifies an answer as `NETWORK` when the fetch throws **or** when the response is `502`, `503`, `504`, or a `5xx` whose body is not JSON. Such an answer carries the network message and `code: 'NETWORK'`. A `5xx` that carries a JSON `message` is still the API's own error and keeps its message.
- A new `lib/connection.ts` holds one `reachable` flag for the tab (`useSyncExternalStore`). `api.ts` reports `false` on every `NETWORK` result and `true` on every answer that came from the API (any status). The browser's `offline` / `online` events also set it. A `generation` counter increments each time the flag goes from `false` to `true`.
- `useLoad` and `usePaged` subscribe to `generation`: a hook that currently holds an error reloads when the connection recovers. Pages self-heal without a click.

### Session

- `OfficeSession` exposes `failed: boolean` beside `ready`. `ready` becomes `true` only when `/office/me` succeeds. On a `NETWORK` failure it sets `failed`, keeps `ready = false`, and retries with backoff 2s → 4s → 8s → 16s → 30s, and immediately on the `online` event or when `reachable` flips to `true`. Any other failure (a 4xx the API chose) also sets `failed` and retries on the same schedule; `LOGIN_REQUIRED` / `DOOR_MISMATCH` already redirect inside `api.ts`.
- `OfficeShell`: while `!ready && !failed` it keeps the `PageSkeleton`. While `failed` it renders an `OutagePanel` in the canvas instead of the page: an `offline` icon, the network title, a sentence that it retries on its own, a `retry` button that calls the session's `retry()` now, and the retrying label while a request is in flight. Pages never mount with a dead session, so their own spinners never start.
- Because `ready` stays `false` during the outage, `allowed()` keeps the full nav list (its existing pre-ready branch). The sidebar does not shrink. The "not ready" group stays exactly as it is.
- Topbar: the greeting, avatar, and wallet keep the cached identity and balance as today; this spec does not change them.

### Mid-session outage

- When the session is ready and `reachable` becomes `false`, the shell shows one `.outage-bar` at the top of the canvas (same place and shape as `.return-bar`): the network title and a `retry` button that calls `api.officeMe()`; a success flips `reachable` back and the bar closes. While the bar is up the shell also re-pings `/office/me` on the same backoff schedule, so the bar closes without a click when the API returns.
- Panes keep their last good data when they have it; a pane that has no data and an error shows `LoadFailed`.

### Failed state in panes

- New `LoadFailed` in `components/load-failed.tsx`: `.empty.empty-state` with the `offline` icon for `NETWORK` and the existing `tasks` icon otherwise, the error text as `.empty-title`, and a `retry` button (`.btn`) when `onRetry` is given. It sits where the table or skeleton would, inside the pane.
- `DataTable` takes `failed?: string` and `onRetry?: () => void`. When `failed` is set and `loading` is false it renders `LoadFailed` instead of the skeleton or the empty sentence. `PagedTable` passes `list.error` and `list.reload` by itself.
- Home: the three stats show `—` when the board failed; the two panes show `LoadFailed` with `board.reload`.
- `/numbers`: `ready` is `catalog.loaded && list.started`, not `catalog.data !== null`.
- Pages that already pass `loading={!x.loaded}` to `DataTable` add `failed={x.error}` and `onRetry={x.reload}`: `/companies`, `/companies/[code]`, `/companies/[code]/[provider]`, `/packages`, `/providers`, `/providers/[code]`, `/roles`, `/users`.
- The page-level `.error` banner stays for action failures. A load failure is shown once, in the pane; `Desk` pages stop passing `list.error` into the banner when the table already shows it.

### Copy

- New keys in `ar`, `en`, `he`: `retry`, `retrying`, `outageTitle`, `outageText`, `loadFailed`. `outageTitle` reuses the Arabic sentence of `NETWORK`.

## Non-goals

- No change to the "not ready" nav group, its items, or their gating.
- No change to the login, password, or two-factor screens.
- No service worker, no offline cache, no queued writes.
- No change to how cached identity and balance show in the topbar.
- No change to the notices stream; its own reconnect already backs off.
