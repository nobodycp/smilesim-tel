# Performance audit — 2026-11-17

Read-only audit of what the user waits for, end to end: the browser, the Next.js web server, the `/api` hop, the
NestJS API, and what is in front of them on the deployment. No application code was changed. Database query plans
and indexes are the subject of the parallel database audit; a slow query met here is named, not analysed.

**Where the numbers come from.** Three sources, each marked on every finding:

- **dev copy** — the running local copy (`next dev` on :3000, API on :3001), measured with the browser pane's
  Resource Timing and with single `curl` requests. Valid in dev: request counts, order, duplicates, payload sizes,
  polling, the API's own response times. **Not valid in dev:** JavaScript sizes and timings, CSS size, first paint —
  `next dev` serves unminified per-route chunks (0.5–0.8 MB each) and compiles on demand. None of those dev-only
  costs is reported as a finding.
- **request log** — `GET /v1/system/requests[/summary]` on the local copy (3,570 rows at the time of reading,
  mostly from the owner's and the agents' sessions today).
- **source** — reading the code; where a cost is inferred rather than measured it says so.

The local data set is tiny (5 accounts, 19 numbers, 36 tasks, 9 companies, 3 offers). Local timings are therefore
floors; every "at scale" statement comes from the source, and one of them (F3) from a micro-benchmark of the API's own
compiled function on synthetic trees.

---

## 1. Summary — what users will feel most

| # | Finding | Measured | Where measured | Priority |
|---|---|---|---|---|
| F1 | **Pictures travel inside JSON lists as base64.** `/v1/companies` 85 KB (90% data URLs), `/v1/packages` 88 KB (79%), `/v1/providers` 133 KB (94%, the same company picture repeated per provider), `/v1/offers` 54 KB (98%). The limits allow 150 KB per company picture and ~700 KB per offer picture, so the same lists can reach **~1.4 MB (9 companies) and several MB (offers)**. The numbers list, tasks list and number card all wait on `/v1/packages` just for filter options. | sizes on dev copy; limits in source | dev copy + source | **P0** |
| F2 | **Offer pictures are stored as uploaded, uncompressed, and the home hero ships them in JSON to every account.** No resize on upload (unlike logos, company marks and QR codes). `/v1/offers/live` carries every live offer's picture; the home screen asks for it on every visit. | 24 KB + 29 KB pictures today; 950,000-char cap per offer | source + dev copy | **P0** once offers are live |
| F3 | **The numbers list does O(N²) work on the API's single thread.** For its `poses` list, `canActivateFor` re-walks the whole account tree once per point of sale. Benchmark of the compiled function: **20 ms at 500 accounts, 261 ms at 2,000, 1,424 ms at 5,000** (branch viewer), per page of the list, during which the API answers nothing else. The `poses` array (every point of sale) is also re-sent on every page. | micro-benchmark | `apps/api/dist` function, synthetic tree | **P1** (P0 at a few thousand accounts) |
| F4 | **Every authenticated request costs ~5 SQL round trips and 1 write before the handler runs**: session + user, all layer policies, an `UPDATE session` (idle slide), user + roles, the layer role; then most handlers read the **whole user table** (`AccountTree.accounts()`, 40 call sites). A cheap authenticated route takes 14–20 ms locally against 1–9 ms unauthenticated. | dev copy + source | dev copy + source | **P1** |
| F5 | **The notices poll is a third of all API traffic.** `/v1/notices` = 1,175 of 3,570 logged requests (33%): a 60 s poll on top of a working SSE stream, a duplicate read on every page load (mount + stream open), and 40 rows fetched where the panel shows 10 (13.5 KB each). | request log + dev copy | request log | **P1** |
| F6 | **Duplicate and oversized reads on open.** Home full load: `/v1/home` twice (screen + sidebar badge), `/v1/notices` twice. Tasks screen computes the **whole all-time overview** (up to 2×20,000 ledger rows + providers) only to show five task counts. The package sheet reads **every line of the package one page of 30 after another** (up to 100 sequential requests). | dev copy + source | dev copy | **P1** |
| F7 | **The web server reads the full branding row (all three images) from the API on every render**: twice per full page load and once per in-app navigation (`generateMetadata`), each a database read of up to ~1.2 MB of base64 to answer 129 bytes. `/branding` is the 2nd most called route (629). | 2 calls per full load, 3 per 3 navigations | dev copy + request log | **P1** |
| F8 | **64% of API answers are 304s that cost the server the same as a 200.** No API answer has `Cache-Control`; Express's weak ETag makes the browser revalidate everything, but the handler, its SQL and the JSON serialisation all run before the hash is compared. | 2,284 of 3,570 | request log | P2 (explains, does not slow) |
| F9 | **Nothing is in front of the server but Traefik; no CDN, no brotli, no HTTP/3.** Static assets and fonts are already immutable-hashed (Next.js), so a CDN is easy — see §5. | — | source + handover doc | P1 (latency from the region) |

The fixes that buy most for least risk, in order: move pictures out of JSON (F1, F2), fix the O(N²) loop (F3), stop
the duplicate and needless reads (F5, F6, F7), then throttle the session write and slim the per-request auth (F4),
then a CDN for static assets (F9).

---

## 2. Findings

### F1 — Pictures inside JSON lists (P0)

**What.** Company pictures are stored as data URLs in `Company.image` and copied into every list that names a
company. Measured on the dev copy (identity bytes; gzip in brackets — base64 barely compresses):

| Route | Size | Share that is data URLs | Data URLs (distinct) | Who reads it |
|---|---|---|---|---|
| `GET /v1/companies` | 85,296 B (55,559 gz) | 90% | 9 (9) | companies, company, package sheet, add-package, providers |
| `GET /v1/packages` | 88,421 B (51,003 gz) | 79% | 8 (8) | **numbers list, tasks list, number card**, packages |
| `GET /v1/providers` | 132,755 B (68,462 gz) | 94% | 14 (**8**) — same picture repeated per provider | providers, add-company, add-package |
| `GET /v1/offers` | 54,307 B | 98% | 2 | offers page |
| `GET /v1/lines/:id` | 16,128 B | 91% (`companyImage` 10 KB + `esimQr` 4.5 KB) | 2 | number card |

The pictures today are ~8.5 KB each because the web shrinks a company picture to 256 px webp before upload
(`apps/web/lib/company-mark.ts:26-40`). The API accepts **150,000 bytes per company picture**
(`apps/api/src/modules/catalog/companies/companies.schemas.ts:27-28`) and does not resize; anything that posts a
bigger file (an API client, an older browser path) is stored as is. At the cap, `/v1/companies` with 9 companies is
~1.9 MB, `/v1/providers` larger still because it repeats them.

**Where.** `companies.service.ts:89` (`image` in the shelf), `providers/directory/providers.service.ts:41`,
`sales/line-reads.ts:123` (`companyImage`), the packages list's `companies[].image`. On the database side the list
queries use `include: { company: true }` (`sales/lines.repository.ts:25,39,68`, `tasks/tasks.repository.ts:39,55,65`),
which pulls the image column out of PostgreSQL even where the answer does not carry it (the numbers list), and
`pos: true` pulls whole user rows (`lines.repository.ts:25`).

**Why users feel it.** The numbers list's table waits for the catalog before it draws
(`features/lines/screens/numbers-screen.tsx:98-101`: `ready = catalog.loaded && list.started`), and the catalog is
mostly pictures the numbers screen does not show. Every screen open re-asks it (`staleTime: 0`,
`lib/use-api-query.ts:39`); the browser's ETag saves the bytes on a repeat but not the server work (F8). A data URL
is also not cached by the browser as an image: it is re-parsed with the JSON on every answer and held in memory once
per copy.

**Fix proposed.** Serve each picture by URL, the way the branding images already are:
`GET /api/companies/:code/image?v=<updatedAt>` (and the same for offers, F2) with
`Cache-Control: public, max-age=31536000, immutable`, and put that URL in the existing `image` / `companyImage`
string field instead of the data URL. Narrow the list queries to `select` what they return (no `image`, no full user
rows). Re-encode on the server at upload (or at least reject over a size/dimension bar the web already meets).

**Cost and risk.** Medium. The field keeps its name and type (a string; `''` when none) but its content changes from a
data URL to a URL: `response-shape.spec.ts` and `lib/api-types.ts` need a note, and the web's `DataImage`
(`components/data-image.tsx`) already accepts any `src`; the CSP already allows `img-src 'self'`. The picture routes
are public like the branding ones today — a company mark is not secret, but the owner should confirm (decision D3).
No stale-price or permission risk: the version in the URL changes on every upload.

### F2 — Offer pictures: no compression, sent to every account (P0 once offers are live)

**What.** The offers page reads the picked file with `FileReader.readAsDataURL` and sends it as is
(`features/offers/screens/offers-screen.tsx:78-86`); the only check is the file size. The API's cap is 950,000
characters of base64 (~700 KB of picture, `catalog/offers/offers.schemas.ts:10`). A phone photo saved as PNG or JPEG
lands near the cap. `GET /v1/offers/live` returns every live offer with its picture to **every account of every
layer** on the home screen, asked again on every home visit (`features/desk/screens/home-screen.tsx:54`). The live
query also loads every active offer's picture before filtering by layer and date
(`offers.repository.ts:16`, filter in `offers.service.ts:54`).

**Measured.** Today `/v1/offers/live` is 13 B (no live offer); the two stored pictures are 24 KB and 29 KB of base64.
Five live offers at the cap would be ~4.7 MB of JSON on the first home load of every session, for every point of sale.

**Fix proposed.** (a) Shrink in the browser like the logo (`lib/branding-image.ts` `shrinkImage`): longest side
1600 px (the hero is a 2:1 tile at most ~60% of the page width), webp at 0.85 — typically 80–200 KB. (b) Serve by URL
(F1). (c) Lower the API's cap to match. **Risk:** low; the offer's stored picture changes only on its next save.
Existing oversized pictures stay until re-saved (or a one-off re-encode, decision D4).

### F3 — O(N²) visibility walk in the numbers list (P1, P0 at a few thousand accounts)

**What.** `sales/line-reads.ts:64-67` builds `poses` (the points of sale the viewer may activate for) with
`accounts.filter((a) => a.layer === 'pos' && visible.has(a.id) && canActivateFor(actor, a, accounts))`, and
`canActivateFor` (`sales/line-ops.ts:31-35`) calls `visibleAccountIds` again — a full tree walk — for every point of
sale. `visible` was already computed one line earlier. For the branch layer `visibleAccountIds` builds a new `Set` of
every account each time (`access/account-visibility.ts:6`).

**Measured** (the API's own compiled `visibleAccountIds` from `apps/api/dist`, synthetic tree of 1 branch, 20 main
agents, 200 agents, the rest points of sale; single run):

| Accounts | Branch viewer | Main-agent viewer |
|---|---|---|
| 500 | 20 ms | 2.5 ms |
| 2,000 | 261 ms | 12.5 ms |
| 5,000 | 1,424 ms | 44 ms |

This is synchronous CPU on the API's one thread: while it runs, every other user's request waits, and the notices
stream's 25 s ping is delayed (see F9 on the 30 s proxy timeout). It runs for **every page** of the numbers list
(first page, each "load more", each filter change), and the `poses` array is re-sent on every page (one entry per
point of sale: ~240 KB at 5,000 accounts). The same file builds a `Map` of all accounts per row through
`tree.pathOf` (`line-reads.ts:61`; 30 rows × N), and `wallets.service.ts:234` does the same per finance row.

**Fix proposed.** Use the `visible` set already computed (the rule `canActivateFor` adds beyond visibility is only
"a point of sale acts for itself"); build the id→account map once per request and pass it to `pathOf`; send `poses`
only with the first page (`cursor` absent). **Risk:** low, behaviour-preserving; the `poses` change affects a list
extra key — the web reads `list.extra` from the last chunk that has it (`lib/use-paged.ts:69-72`), so first-page-only
already works with the pager.

### F4 — Per-request authentication and the whole-tree read (P1)

**What.** `access/actor-resolver.ts:28-50` and `auth/prisma-auth.store.ts:374-414`, for every authenticated request:

1. Redis `EXISTS session:<hash>`
2. `session.findUnique` + `include: { user: true }`
3. `layerPolicy.findMany()` (session rules — read every time, never cached, `prisma-auth.store.ts:264-271`)
4. Redis `EXPIRE`
5. **`session.updateMany` (lastSeenAt, expiresAt) — a write on every GET**
6. `user.findUnique` + role + extra roles
7. `role.findUnique` (layer role) for non-owners

All sequential. Then most handlers call `AccountTree.accounts()` (`access/account-tree.ts:18-23`), which reads
**every user** (40 call sites; `me`, `home`, every list), sometimes twice in one request (`line-reads.ts` detail).
Before all that: the rate limiter's Redis `MULTI` and the request-log middleware.

**Measured (dev copy).** `/health` 1 ms, `/branding` (public) 5–9 ms, the cheapest authenticated routes
(`/v1/provider-decisions`, 77 B) 14–20 ms. On the server, every SQL round trip adds the container-to-container
latency; at 4–6 parallel requests per screen open, the session `UPDATE`s also queue on the same row.

**Fix proposed.** (a) Slide the session in the database at most once a minute (Redis `EXPIRE` stays per request and
remains the authority for "live"); (b) cache the layer policies in process with a short life, cleared on
`setSessionRules`; (c) one query for user + roles + layer role; (d) read the tree once per request (a request-scoped
memo) and, later and only if measured necessary, cache it in Redis behind a tree version bumped by every write that
changes parent, layer, `deniedOps` or `disabledAt`. **Risk:** (a) changes the idle-out precision by up to a minute —
a security setting, owner decision D6. (d)'s Redis cache can serve a stale permission if one writer forgets the bump
— do not start there; the request memo alone removes the double reads with no staleness.

### F5 — Notices: poll, duplicates, over-fetch (P1)

**What.** `lib/use-notices.ts`: one `EventSource` per tab (good), plus `pull()` on mount **and** again in
`source.onopen` (two reads on every full load, measured starting at 789 ms and 1,005 ms), plus a
60 s `setInterval` poll that runs even while the stream is healthy (`POLL_MS`, line 11). Each pull is
`GET /v1/notices` — 40 rows (`NOTICES_PAGE`, `platform/paging.ts:14`), 13,471 B — of which the panel keeps 10
(`PANEL`, line 9). The `/notices` page itself reads the same list again (measured: two `/v1/notices` within 3 s on
opening it).

**Measured.** Request log: `/v1/notices` 1,175 calls of 3,570 (busiest route; median 39 ms, p95 348 ms); log rows
show the 60 s beat from each open tab. With F4's per-request cost, each tab costs ~8 SQL statements a minute for a
list that SSE already keeps current.

**Fix proposed.** Pull once when the stream opens (drop the mount pull), poll only while the stream is down (or every
5 min as a safety net), and ask for `?limit=10` (an additive query parameter) for the panel. **Risk:** low. Shape
unchanged.

### F6 — Duplicate and oversized reads when a screen opens (P1)

Measured on the dev copy (requests a screen makes after its RSC payload, in order; sizes decoded):

| Screen | API requests | Notes |
|---|---|---|
| Home (full load) | 11: branding logo + logo-dark (from cache), `home`, `overview?period=month`, `offers/live`, `finance/summary`, `me`, then `notices`, **`home` again**, `directory`, **`notices` again** | duplicates: `home`, `notices` |
| Home (in-app) | 4: `home`, `overview`, `offers/live`, `finance/summary` | overview p95 935 ms in the log |
| Numbers | `lines` (8 KB), **`packages` (88 KB)** | table waits for `packages` |
| Tasks | `packages` (88 KB), `tasks` (19 KB), `provider-decisions`, **`overview?period=all`** | overview only for 5 counts |
| Number card | `lines/:id` (16 KB, median 390 ms / p95 1,065 ms in the log — slowest real screen route), `packages` (88 KB), `directory?mine=1` | |
| Providers | `providers` (133 KB), `companies` (85 KB), `provider-accounts` | 218 KB, 94%/90% pictures |
| Audit | three `audit` reads in parallel (16 KB + 0 + 20 KB) | the failed-sign-in panel reads with `addresses=1` |
| Finance | `finance` (35 KB, 80 rows) | fine |

- **Home twice.** The sidebar reads `/v1/home` for the open-tasks badge (`components/app-shell.tsx:266`, enabled
  once `me` answered); the home screen reads the same key (`home-screen.tsx:49`). `useApiQuery` forces
  `staleTime: 0` (`lib/use-api-query.ts:39`), so the second observer refetches an answer 350 ms old. `/v1/home` is
  the 3rd busiest route (235 calls, median 93 ms, p95 645 ms) — on every page but home it exists only for a badge.
- **Overview for five numbers.** `features/tasks/screens/tasks-screen.tsx:113` reads `overview('all')`, which runs
  `OverviewService` in full: two ledger reads of up to 20,000 rows each (`reporting/desk/overview.service.ts:19,
  114-125, 205-215`), the providers' accounts, the supply report and provider health — to use `.tasks`.
- **Package sheet reads every line.** `features/catalog/screens/package-sheet-screen.tsx:76-89` loops
  `api.lines({ packageCode, cursor })` up to 100 pages of 30, sequentially. A package with 1,500 numbers = 50 round
  trips, each with F3's and F4's costs. The balances report does the same in pages of 200 (`features/reports/api.ts:10-13`,
  up to 50).
- **Notice click reloads the whole app.** `app-shell.tsx:199` `window.location.assign(row.href)`: a full SSR,
  `me`, `directory`, two `notices`, two `/branding`, the stream reconnect — for an in-app link (already listed as an
  open defect in `docs/architecture/frontend.md` §Known defects 7).

**Fix proposed.** (a) A short de-duplication window in `useApiQuery` (e.g. `staleTime: 5_000` default; the cached
answer still shows at once and writes still invalidate), which removes both duplicates without user-visible
staleness. (b) The tasks list answers its status counts as an extra key, or a small `GET /v1/tasks/counts`; the tasks
screen stops reading the overview. (c) The package sheet's operations tab searches lines on the server (the
numbers list's own filters) instead of holding all of them; if the whole set is truly needed, one endpoint that
returns only id/msisdn/status for a package. (d) `router.push` for in-app notice links. **Risk:** (a) is the only
one with any staleness (5 s, same tab) — owner decision D5 states which reads may never be served from cache.

### F7 — Branding read on every render (P1)

**What.** `apps/web/app/layout.tsx:39-46` (`generateMetadata`) and `:58` (`RootLayout`) both call `loadBranding()`
(`lib/branding-load.ts:16`), a `fetch` with `cache: 'no-store'` and an `AbortSignal` (so React's request
memoisation does not merge them). On the API, `BrandingService.summary()` (`modules/branding/branding.service.ts:23-25`)
loads the whole `SiteBranding` row — logo, dark logo and favicon data URLs, up to 300 KB of picture each — to answer
name, tagline, two booleans and a version. The image route does the same for one image.

**Measured.** 2 `/branding` calls per full page load; 3 calls over 3 in-app navigations (the root
`generateMetadata` runs on each RSC navigation). Request log: 629 calls, 2nd busiest route. Each SSR waits on it
(up to the 1.5 s timeout if the API is slow).

**Fix proposed.** API: `select` only the summary columns for `GET /branding`, only the asked column for the image.
Web: wrap `loadBranding` in React `cache()` so one render reads it once; optionally a short revalidate (e.g. 60 s) in
the web server's memory, since the version in the image URL already busts the picture. **Risk:** none for the select
and `cache()`; a 60 s revalidate shows a renamed office up to a minute late on other tabs (D5).

### F8 — 304s that cost a full answer (P2)

**What.** No JSON answer sets `Cache-Control`; Express adds a weak `ETag` (`W/"…"`). Browsers store the answer and
revalidate with `If-None-Match`, Express answers 304 after the handler, its SQL and `JSON.stringify` have all run.
**Measured:** 2,284 of 3,570 logged requests were 304 — `/v1/notices` 1,136, `/v1/home` 223, `/v1/me` 190,
`/v1/directory` 187, `/v1/packages` 63 — with the same medians as their 200s. Routes that never 304 either change
every time (overview, system status, request-log summary — inferred: time-relative figures) or are fetched by the
web server with `cache: 'no-store'` (`/branding`). Resource Timing in the browser shows `transferSize` 300 B for
these (headers only).

**Fix.** Nothing to change for speed by itself — fixing F1/F4/F5 lowers the server cost these 304s still pay. But
before any CDN (F9), every JSON answer should say `Cache-Control: private, no-cache` (or `no-store` for anything
sensitive) so no shared cache ever stores an account's answer. A real conditional answer (skip the work when nothing
changed) is only worth it for the catalog and would need a version per account view — not recommended now.

### F9 — Delivery: compression, HTTP versions, proxy hop, CDN (P1)

**Today** (`docs/handover/technical-operations-ar.md` §1–5): browser → HTTPS → Traefik (Coolify) → web :3000 →
`/api` rewrite → api :3001. Only the web has a public name; the five door hosts all point at the web. Cloudflare is
used for DNS only, not proxied.

- **Compression.** The API does not compress (no `compression` in `main.ts`; measured: no `Content-Encoding` on
  `:3001`). Next.js does: through the rewrite the dev copy answers `Content-Encoding: gzip` for `/api/*`
  (`/v1/companies` 85,296 → 55,540 B, `/v1/home` 1,442 → 505 B) and for pages. **To confirm on a production build:**
  that `next start`'s `compress` also wraps the proxied `/api` answers (inferred yes; not measurable here). No brotli
  anywhere. The SSE stream is correctly left uncompressed and unbuffered (`Cache-Control: no-cache, no-transform`,
  `X-Accel-Buffering: no`, measured through the proxy).
- **The `/api` hop.** `next.config.mjs` rewrites `/api/:path*` to the API; Next proxies each request with a new
  `httpxy` proxy on Node's default (keep-alive) agent (`node_modules/next/dist/server/lib/router-utils/proxy-request.js`).
  `proxy.ts` runs on `/api/*` too (its matcher excludes only `_next/static`, `_next/image`, `favicon.ico`) — it must:
  it overwrites the browser's `x-door` with the host's door, which the API trusts. **Measured overhead (dev):**
  4–10 ms per request (`/v1/me` 14 → 18–27 ms; `/v1/companies` 18–21 → 24–34 ms). Acceptable; production should be
  lower. **Proxy timeout:** Next's rewrite proxy times out an idle upstream after **30 s**; the notices stream pings
  every **25 s** (`notifications/notices.controller.ts:11`). A 5 s margin — F3's blocking loop or a GC pause can cut
  streams (the client reconnects with back-off, so the cost is reconnect churn plus a `notices` re-read). Lower the
  ping to 15 s, or set `experimental.proxyTimeout` explicitly.
- **HTTP/2 / HTTP/3.** Traefik terminates TLS and speaks HTTP/2 to browsers (inferred from Coolify defaults, not
  measured here); no HTTP/3. Web→API is HTTP/1.1 keep-alive inside the Docker network — fine.
- **What a CDN could cache at all.** Only what is identical for every user and versioned in its URL:
  `/_next/static/*` (JS, CSS, fonts under `/_next/static/media`; Next sends `public, max-age=31536000, immutable`
  in production), `/api/branding/{logo,logo-dark,favicon}?v=…`, and after F1/F2 the company and offer pictures with
  `?v=`. **Never:** HTML (per-request CSP nonce, account cookies; Next already sends `Cache-Control: no-store`), any
  other `/api/*`, the SSE stream.
- **A defect to fix first:** the branding image route sends `immutable, max-age=31536000` even without `?v=`
  (`modules/branding/branding.controller.ts:56`; measured: `/api/branding/logo` with no version → immutable). Behind a
  CDN that would pin an old logo for a year. It should be immutable only when `v` equals the current version, else
  `no-cache`.

See §5 for the recommended setup.

### F10 — Front-end weight (from source; sizes need a production build)

- **Dependencies are light.** `apps/web/package.json`: React, Next, TanStack Query, `radix-ui` (umbrella, used only
  in `components/ui/*`), `lucide-react` (named imports everywhere — Next optimises this package's imports by
  default), `class-variance-authority`, `clsx`, `tailwind-merge`, `@simplewebauthn/browser` (only on the sign-in
  and settings screens). No chart library (charts are hand SVG: `donut.tsx`, `sparkline.tsx`, `trend-line.tsx`), no
  date library, no QR library in the browser (QR pictures are made on the API). Good.
- **No `next/dynamic` anywhere.** 144 of 269 source files are client components. Candidates for on-demand loading,
  once a build shows they matter: the dialogs (`transfer-dialog.tsx`, `line-prices-dialog.tsx`,
  `disconnect-confirm.tsx`, the eSIM dialog), `@simplewebauthn/browser` behind the passkey button, the branding
  editor's canvas code. Not a finding until measured (§7).
- **Fonts** (`app/layout.tsx:21-33`, `next/font/google`, self-hosted, `display: swap` — good). Noto Kufi Arabic is
  one variable file per subset (Arabic 124 KB, Latin 31 KB). IBM Plex Sans Hebrew is four static weights, and
  **all six files are preloaded on every page in every locale** (measured: 6 `<link rel=preload as=font>`; the four
  Hebrew ones ~4 KB each). Fix: `preload: false` on the Hebrew face (its `unicode-range` still loads it the moment
  Hebrew text appears). P2, ~16 KB and four requests off every first visit.
- **Both logo copies are fetched.** `components/brand-logo.tsx:18-19` renders the light and the dark logo and hides
  one with CSS; React preloads both (measured: two `rel=preload as=image`, 11.9 KB + 12.5 KB). The theme is known
  on the server (cookie). P2: render the current theme's copy only, or accept it (both are immutable-cached after the
  first visit).
- **Images have sizes** (company marks `size-8`/`size-11.5`, the hero `aspect-[2/1]`), so no layout shift from them.
- **Long lists**: tables page on the client (10/15/20 or "all"), pickers show 8 (`components/name-field.tsx:12`),
  shell search 8 + 5. Measured 681 DOM nodes on home. No virtualisation needed today.
- **Context re-renders.** `DeskSession`'s provider value is a new object each render and the component reads
  `usePathname()` (`lib/desk-session.tsx:57,124-137`), so every `useDesk()` consumer re-renders on every navigation.
  P2: `useMemo` the value.
- **The stylesheet.** One Tailwind 4 sheet; the dev copy's is 209 KB of rule text, which says nothing about the
  production sheet (Tailwind emits only used utilities, minified). Measure on CI (§7).

### F11 — Perceived speed

- **Skeletons:** 20 components/screens use `TableSkeleton`/loading cards; of 37 screens that read data, two have no
  loading state (`features/branding/screens/branding-screen.tsx`, `features/catalog/screens/add-company-screen.tsx`).
  No `loading.tsx` (by design: each screen draws its own skeleton).
- **Keep-previous on filter change:** yes (`usePaged`, `placeholderData: keepPreviousData`). **Debounce on search:**
  yes, 300 ms (`lib/url-state.ts`). Both good.
- **Optimistic updates:** none (`onMutate`/`setQueryData` unused). For money and line status this is right (the
  server decides); for "mark notice read" it is already done locally in `use-notices.ts`.
- **Prefetch:** no query prefetch on hover or intent (`prefetchQuery`/`router.prefetch` unused). `next/link` prefetch
  is on by default in production; whether it fetches anything for these fully dynamic routes, and how many
  `generateMetadata` → `/branding` calls that causes (F7), must be measured on a production build (§7). Cheap wins
  after F1: prefetch the number card's `lines/:id` on row hover, and the catalog once after sign-in.
- **The slowest click-to-content today** (request log, p95): number card `GET /v1/lines/:id` 1,065 ms (median 390),
  `GET /v1/finance/summary` 945 ms, `GET /v1/overview` 935 ms — the home screen waits on the last two. (Database
  audit: please look at these three.)

### F12 — Worker and background work

Measured intervals (source): outbox relay every 2 s, provider recovery 30 s, sweep 60 s
(`worker/provider-dispatch.ts:23-26`), alert pass 30 s with ~10 windowed reads over the request and activity logs
(`monitoring/alert-pass.ts`, `thresholds.ts:38`), worker watch 30 s, heartbeat 20 s, request-log writes batched every
2 s in the API (`request-log.writer.ts:9`). All light today. The request log adds one row per API request; F5's
notices poll is a third of those rows, so F5 also shrinks the table the alert pass scans. The alert pass's
`percentile_cont` over the window is a database-audit item.

---

## 3. What is already good (do not redo)

- Branding images are served as bytes by URL with a version and `immutable` (`branding.controller.ts:41-58`); the
  web shrinks logos to 768 px / favicon 256 px webp, company marks to 256 px webp, QR codes to 640 px PNG before
  upload (`lib/branding-image.ts`, `lib/company-mark.ts`, `lib/qr-image.ts`). The pattern to copy for F1/F2.
- eSIM codes are not in any list, only in the number's detail (`line-reads.ts:52`).
- Every list is cursor-paged with a bounded page (`platform/paging.ts`: 30–200) and capped lists say `capped`.
- TanStack Query everywhere: cached answers show at once, keep-previous on filters, invalidation after writes,
  `refetchOnWindowFocus: false`, polling paused in hidden tabs.
- The screen does not wait for `me`: page reads start in parallel with it (measured: `home`, `overview`,
  `offers/live`, `finance/summary`, `me` all started within 11 ms).
- SSE done right: Redis pub/sub per user, `no-transform`, `X-Accel-Buffering: no`, heartbeat, session re-checked on
  the beat, `forceCloseConnections` on shutdown, not counted by the rate limiter or the request log.
- Fonts self-hosted through `next/font` with `display: swap` and subsets; one variable Arabic face.
- Next.js compresses pages and the proxied `/api` answers (gzip, dev copy); `/_next/static` is content-hashed.
- No heavy client dependencies (F10).
- The request log itself (median/p95 per route) — the measurement tool for every slice below.

---

## 4. Proposed slices (one commit each, ordered by value and risk)

Each slice states its before/after measurement. "Log" = `GET /v1/system/requests/summary` filtered by route after
exercising the screen; "RT" = the browser's Resource Timing on the dev copy (request count, decoded bytes); "bench"
= the synthetic-tree micro-benchmark used for F3.

| # | Slice | Measure before → after | Risk |
|---|---|---|---|
| S1 | API: `GET /branding` and the image route `select` only their columns; branding image `immutable` only with the current `?v=`; web: `cache()` around `loadBranding` | `/branding` calls per full load 2 → 1; rows read per call | none; fixes the CDN pin |
| S2 | Numbers list: reuse `visible`, one account map per request, `poses` on the first page only | bench 1,424 ms → < 20 ms at 5,000; `/v1/lines` page size | low |
| S3 | Notices: one pull per stream open, poll only while the stream is down, `?limit=10` for the panel; ping 25 s → 15 s | log: `/v1/notices` calls per tab-minute 1 → ~0; bytes 13.5 KB → ~3.5 KB | low |
| S4 | `useApiQuery` de-dup window (5 s) | RT home full load: 11 → 9 API requests | low (D5) |
| S5 | Tasks counts without the overview (extra key on `/v1/tasks` or `/v1/tasks/counts`) | RT tasks screen: no `overview?period=all`; log p95 | low; additive shape |
| S6 | Offer pictures shrunk in the browser (1600 px webp), API cap lowered | stored size of a test picture | low |
| S7 | Company and offer pictures by URL (`/companies/:code/image?v=`, `/offers/:id/image?v=`), lists carry the URL; list queries `select` without the image column | `/v1/companies` 85 KB → ~8 KB, `/v1/packages` 88 KB → ~19 KB, `/v1/providers` 133 KB → ~8 KB, `/v1/offers/live` | medium: field content changes (spec + `response-shape.spec.ts`) |
| S8 | Package sheet's operations tab without reading every line | RT: N sequential `/v1/lines` → 1 | medium (behaviour of the tab; needs a spec) |
| S9 | Session slide throttled to once a minute; layer policies cached in process; one query for user + roles; tree read once per request | log: median of a cheap authenticated route; SQL statements per request (read the code path) | medium: security setting (D6) |
| S10 | Notice links and other in-app full reloads → `router.push` | RT: no document request on a notice click | low |
| S11 | Explicit `Cache-Control: private, no-cache` on every JSON answer (a middleware), `public, immutable` only on versioned pictures | curl headers per route class | low; prerequisite for S12 |
| S12 | Cloudflare in front (§5) — deployment change, no code | from the region: TTFB of `/_next/static/*` and pictures, `cf-cache-status: HIT` | deployment (D1) |
| S13 | P2 polish: Hebrew font `preload: false`; one logo copy per theme; `useMemo` the desk context; `next/dynamic` for dialogs if S14 shows weight | RT: preloads 6 → 2; build report | low |
| S14 | CI: production measurement job (§7) | — | CI only |

S1–S5 are behaviour-preserving and small; S7–S9 need a spec and plan before code (`work-plan.mdc`). S14 can land at
any time and should land before S13 so the front-end slices have numbers.

---

## 5. Recommended CDN and edge setup

**Recommendation: Cloudflare proxy (orange cloud) on the five door hosts**, since the account and DNS are already
there and R2 is planned. Free or Pro plan is enough.

What must be true in the app first (S1, S11):

1. Every JSON answer says `Cache-Control: private, no-cache` (or `no-store`); HTML already says `no-store`.
2. The branding (and later company/offer) image routes are `public, max-age=31536000, immutable` **only** for the
   current `?v=`; anything else `no-cache`.
3. `/_next/static/*` keeps Next's immutable header (it does by default).

Cloudflare configuration:

- **Cache rules:** cache everything for `/_next/static/*` (respect origin headers, edge TTL 1 year); cache
  `/api/branding/*` and (after S7) `/api/companies/*/image` and `/api/offers/*/image` **only when the query string
  has `v`**, cache key including the query string. **Bypass** everything else, explicitly: `/api/*`, HTML, and
  `/api/v1/notices/stream`.
- **Hosts:** the cache key includes the host, so the same asset is cached once per door host (5×). Harmless at
  this size; if it matters later, `assetPrefix` to one static host. Session cookies are host-wide on the parent
  domain (`COOKIE_DOMAIN`); Cloudflare does not cache a response that sets a cookie, and the cached paths never set
  one.
- **Compression:** brotli at the edge (on by default for text types); Next's gzip from the origin still applies on
  the bypassed paths. **HTTP/3** and 0-RTT off (0-RTT replays requests; leave it off for an app with writes).
- **SSE:** Cloudflare streams `text/event-stream` without buffering; its idle timeout (100 s on Free/Pro) is above
  the ping, so the stream survives. Keep `no-transform` (it also stops edge compression of the stream).
- **The real client address:** a second proxy hop. Traefik must trust Cloudflare's address ranges for
  `X-Forwarded-For` (or read `CF-Connecting-IP`), and `TRUST_PROXY` becomes 2. The handover doc already flags this
  (§5, §6); the rate limiter, sign-in lockout and activity log all depend on it — verify with the two-request check
  the handover describes. Lock the origin to Cloudflare's ranges at the firewall so the proxy cannot be bypassed.
- **What a CDN does not fix:** every API call still goes to the one server. The latency users feel on lists comes from
  F1–F6, not from the static files.

Alternative without a CDN: Traefik's `compress` middleware (gzip/brotli) on the web router in Coolify. It adds brotli
but not edge caching or HTTP/3; acceptable if the users are all near the server.

---

## 6. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | A CDN, and which | Cloudflare proxy on the five hosts (§5), after S1 and S11. Static assets and versioned pictures only. |
| D2 | Where pictures live | **Keep them in the database for now, but serve them by URL** (S7). The total is small (tens of pictures, each ≤ 150–300 KB after shrinking), and the database is already backed up encrypted to R2; a disk volume adds a second thing to back up, object storage (R2 public bucket) adds a second origin to the CSP and a second credential. Revisit if pictures grow past a few hundred or uploads become user-facing at the point of sale. |
| D3 | Company and offer picture routes public (like branding) or behind the session | Public with a versioned URL: they are marketing images shown to every layer, and public is what lets a CDN cache them. If any picture must stay private, it stays behind the session and is never CDN-cached. |
| D4 | Image formats and limits | Accept PNG/JPEG/WebP; store WebP. Company mark 256 px, ≤ 50 KB; offer 1600 px, ≤ 300 KB; logo 768 px / favicon 256 px as today; QR stays PNG (hard edges). Re-encode existing oversized offer pictures once, or leave them until next save. |
| D5 | What may be served from cache, and for how long | **Never from cache without revalidation:** prices, balances, grants and stops, line status, task state. **A few seconds of de-duplication in the same tab** (S4): fine for everything. **Up to 60 s in the web server:** the office name/tagline. **Immutable by version:** pictures, static assets. No Redis cache of prices or permissions until a measurement shows the request-scoped memo is not enough. |
| D6 | Session idle slide written once a minute instead of on every request | Yes: the idle timeout becomes precise to a minute; Redis TTL stays exact per request, and sign-out/revoke remain immediate. |
| D7 | A production-like measurement on CI (no builds on the owner's machine) | Yes (§7): one job on the work branch, not blocking at first. |

---

## 7. What could not be measured here, and how to measure it

| Not measured | Why | How |
|---|---|---|
| JS bundle per route, CSS size, font bytes in production | no `next build` on this machine | CI job after `npm run build`: keep Next's route size table as an artifact; add a bundle analysis (Next 16's own analyser if the installed version has it, else `@next/bundle-analyzer` — a dev dependency, decision); fail later on a budget. |
| First paint, LCP, CLS, INP | dev server timings are not production | CI job: `next start` + the API on the mock (as the e2e job does) and Lighthouse CI on home, numbers, tasks, number card, providers, both themes, ar + he; or the same against the trial server. |
| Whether `next start` gzips proxied `/api` answers | dev only shows dev behaviour | one `curl -H 'accept-encoding: gzip' -D -` against the trial server's `/api/v1/companies`. |
| Link prefetch traffic in production | `next dev` does not prefetch | Network panel on the trial server after sign-in: RSC prefetch requests and `/branding` calls in the API log. |
| Real network latency and TLS/HTTP version | local only | from a phone on mobile data to the trial server: TTFB of `/login`, `/_next/static/*`, `/api/v1/me`; `curl --http2 -w '%{http_version}'`. |
| Behaviour at real data volume | 5 accounts, 19 numbers locally | a seeded load copy (thousands of accounts and numbers) on the trial server or a CI database, then the request log's p95 per route; S2's benchmark is the in-process stand-in. |
| Query plans of the slow routes (`lines/:id`, `finance/summary`, `overview`) | the database audit's subject | see the database audit of 2026-11-17. |

---

## Appendix — raw measurements (dev copy, 2026-11-17)

API answers, single requests, branch owner session, direct to :3001 (bytes identity / gzip -6):

```
/v1/me 289 · /v1/home 1,442/519 · /v1/overview?period=month 4,367/1,169 (76 ms)
/v1/companies 85,296/55,559 · /v1/packages 88,421/51,003 · /v1/providers 132,755/68,462
/v1/offers 54,307/17,129 · /v1/offers/live 13 · /v1/lines 7,981/1,594 · /v1/tasks 19,486/2,668
/v1/finance 34,812/4,697 · /v1/notices 13,471/3,265 · /v1/audit 19,534/3,307
/v1/system/requests 35,271/5,796 · /v1/lines/:id 16,128 (336 ms cold, 41–55 ms warm)
```

Request-log summary at the time of reading: 3,570 requests; slowest by p95 — `/v1/system/errors` 1,494 ms,
`POST /v1/system/versions/check` 1,299 ms, `/v1/lines/:id` 1,065 ms, `/v1/finance/summary` 945 ms, `/v1/overview`
935 ms; busiest — `/v1/notices` 1,175, `/branding` 627, `/v1/home` 235, `/v1/me` 233, `/v1/directory` 190.
