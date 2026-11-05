# Site Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A branch owner sets the office name, tagline, logo, and tab icon from `/branding`, reached through a collapsible "Settings" group in the sidebar's Admin section, and the saved identity shows on the shell, the sign-in page, the tab title, and the favicon.

**Architecture:** One `SiteBranding` row read by a public `GET /branding` and written by an owner-only `PUT /branding` in a new `branding` Nest module (pure rules + a swappable store). The Next layout loads the row on the server into a `BrandingProvider`; the shell, auth screens, and metadata read it through `useBranding()`. The browser shrinks uploads and builds the dark logo copy before sending data URLs.

**Tech Stack:** NestJS 12, Prisma (PostgreSQL), Jest + supertest; Next.js app router, React, `lucide-react`, CSS with `--rd-*` tokens.

**Spec:** `docs/superpowers/specs/2026-11-05-site-branding-design.md`

## Global Constraints

- Colours only through `--rd-*` tokens (or the hotspot aliases); no hex or `rgba()` outside `tokens.css`.
- Copy keys exist in `ar.ts`, `en.ts`, and `he.ts`; `npm run check:copy` must pass.
- Logical properties only (`inset-inline-end`, `margin-inline`, `padding-inline`).
- No height animation on the nav group; DESIGN.md's motion list is closed.
- Server limits: `siteName` ≤ 120 chars, `tagline` ≤ 160 chars, each image ≤ 300 000 decoded bytes, `image/png` or `image/webp` only, else `INVALID`.
- Browser limits: logo ≤ 768px longest side, favicon ≤ 256px, output `image/webp`.
- JSON body limit 1 MB in `apps/api/src/main.ts`.
- Spec section "Sidebar: collapsible Settings group" fixes the behaviour of the group; "Branding page" fixes the composition and copy.

## Review Focus

- A JPEG or SVG dropped on a drop field: the browser refuses it, keeps the old image, and shows the `brandingTooLarge` banner (its text names the accepted types) — Task 7's `shrinkImage` returns `''` for `image/jpeg`; Task 8 shows the banner on `''`.
- Save with every field empty and no images: `PUT` stores `''`/`null`, `GET` answers `version > 0`, and the shell falls back to `t.brand` — Task 3 HTTP test.
- An API that is down when the layout renders: the page still renders with defaults within the timeout — Task 5 unit test on `loadBranding` with an unreachable base URL.
- A logo with no dark copy (older row or a client that sent only `logo`): `logo-dark` must fall back to `logo` — Task 2 rule and Task 3 HTTP test.
- Owner on the branch door but impersonating a sub-account: `PUT` is `403` — Task 3 HTTP test.

---

### Task 1: Prisma model and migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (after `model Announcement`)
- Create: `apps/api/prisma/migrations/20261105100000_site_branding/migration.sql`

**Interfaces:**
- Produces: Prisma model `SiteBranding { id Int @id @default(1); siteName String @default(""); tagline String @default(""); logo String?; logoDark String?; favicon String?; updatedAt DateTime @updatedAt }`.

- [ ] **Step 1: Add the model to `schema.prisma`**

- [ ] **Step 2: Write the migration**

```sql
-- Office identity: one row (id = 1) the branch owner edits from /branding.
CREATE TABLE "SiteBranding" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "siteName" TEXT NOT NULL DEFAULT '',
  "tagline" TEXT NOT NULL DEFAULT '',
  "logo" TEXT,
  "logoDark" TEXT,
  "favicon" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteBranding_pkey" PRIMARY KEY ("id")
);
```

- [ ] **Step 3: Regenerate the client**

Run: `cd apps/api && npx prisma generate`
Expected: "Generated Prisma Client" and `src/generated/prisma/client` knows `siteBranding`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): SiteBranding row"
```

---

### Task 2: Branding rules (pure)

**Files:**
- Create: `apps/api/src/modules/branding/branding-rules.ts`
- Test: `apps/api/src/modules/branding/branding-rules.spec.ts`

**Interfaces:**
- Produces:
  - `type BrandingRow = { siteName: string; tagline: string; logo: string | null; logoDark: string | null; favicon: string | null; updatedAt: Date }`
  - `type BrandingBody = { siteName: string; tagline: string; logo: string | null; logoDark: string | null; favicon: string | null }`
  - `parseBrandingBody(body: unknown): BrandingBody` — throws `OfficeFailure(400, 'INVALID')` (import from `../office/office.service`) on any violated limit; trims the strings; a missing or `''` image is `null`.
  - `decodeImage(dataUrl: string | null): { type: 'image/png' | 'image/webp'; bytes: Buffer } | null`.
  - `brandingSummary(row: BrandingRow | null): { siteName: string; tagline: string; hasLogo: boolean; hasFavicon: boolean; version: number }` — `version = row ? row.updatedAt.getTime() : 0`.
  - `IMAGE_LIMIT = 300_000`, `NAME_LIMIT = 120`, `TAGLINE_LIMIT = 160`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('branding rules', () => {
  const png = `data:image/png;base64,${Buffer.alloc(64, 1).toString('base64')}`;
  it('trims names and keeps images', () => {
    expect(parseBrandingBody({ siteName: ' Pro ', tagline: '', logo: png, logoDark: png, favicon: null }))
      .toEqual({ siteName: 'Pro', tagline: '', logo: png, logoDark: png, favicon: null });
  });
  it('refuses a name over 120 characters', () => {
    expect(() => parseBrandingBody({ siteName: 'x'.repeat(121), tagline: '' })).toThrow(OfficeFailure);
  });
  it('refuses a jpeg and an oversize image', () => {
    const jpeg = `data:image/jpeg;base64,${Buffer.alloc(64, 1).toString('base64')}`;
    const big = `data:image/png;base64,${Buffer.alloc(300_001, 1).toString('base64')}`;
    expect(() => parseBrandingBody({ siteName: '', tagline: '', logo: jpeg })).toThrow(OfficeFailure);
    expect(() => parseBrandingBody({ siteName: '', tagline: '', favicon: big })).toThrow(OfficeFailure);
  });
  it('decodes a data url to bytes and a type', () => {
    expect(decodeImage(png)).toEqual({ type: 'image/png', bytes: Buffer.alloc(64, 1) });
    expect(decodeImage(null)).toBeNull();
  });
  it('summarises a missing row as version 0 with defaults', () => {
    expect(brandingSummary(null)).toEqual({ siteName: '', tagline: '', hasLogo: false, hasFavicon: false, version: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && npx jest src/modules/branding/branding-rules.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `branding-rules.ts`**

The data-URL regex is `/^data:image\/(png|webp);base64,([A-Za-z0-9+/=]+)$/`, as in `setCompanyImage`.

- [ ] **Step 4: Run to verify pass**

- [ ] **Step 5: Commit** — `feat(api): branding rules`

---

### Task 3: Branding store, service, controller, module

**Files:**
- Create: `apps/api/src/modules/branding/branding.store.ts` (`BRANDING_STORE` token, `BrandingStore` interface, `MemoryBrandingStore`)
- Create: `apps/api/src/modules/branding/prisma-branding.store.ts`
- Create: `apps/api/src/modules/branding/branding.service.ts`
- Create: `apps/api/src/modules/branding/branding.controller.ts`
- Create: `apps/api/src/modules/branding/branding.module.ts`
- Modify: `apps/api/src/modules/registry.ts` (add `BrandingModule`)
- Modify: `apps/api/src/main.ts` (body limit)
- Test: `apps/api/src/modules/branding/branding.http.spec.ts`

**Interfaces:**
- Consumes: Task 2 functions; `AUTH_STORE`/`AuthStore.liveSession` from `../auth/auth.store`; `ActivityRecorder.recordOffice(gate, ip, { action: 'site_branding' }, result, reason)` (global module).
- Produces:
  - `interface BrandingStore { load(): Promise<BrandingRow | null>; save(body: BrandingBody): Promise<BrandingRow> }`; `PrismaBrandingStore` uses `prisma.siteBranding.upsert({ where: { id: 1 }, create: { id: 1, ...body }, update: body })`.
  - `BrandingService.summary()`, `.image(kind: 'logo' | 'logo-dark' | 'favicon')` (`logo-dark` falls back to `logo`), `.save(gate, body)` — owner gate: `live.session.scope === 'full' && live.session.kind !== 'impersonation' && live.user.layer === 'branch' && live.user.isBranchOwner && !live.user.disabledAt`, else `OfficeFailure(403, 'FORBIDDEN')`; no session is `401 LOGIN_REQUIRED`.
  - Routes: `GET /branding`, `GET /branding/logo`, `GET /branding/logo-dark`, `GET /branding/favicon`, `PUT /branding`. Image routes set `Content-Type`, `Cache-Control: public, max-age=31536000, immutable`, and send the buffer; missing → `404` with `errorBody('NOT_FOUND')`.
  - Errors use the same `{ message, code }` body as `OfficeController.run`.

- [ ] **Step 1: Write the failing HTTP tests** (pattern of `account.http.spec.ts`: `MemoryAuthStore`, login for cookies, `Test.createTestingModule({ imports: [AuthModule, BrandingModule] }).overrideProvider(AUTH_STORE).useValue(store).overrideProvider(BRANDING_STORE).useValue(new MemoryBrandingStore())`)

Tests:
- `GET /branding` without a cookie answers `200` and `{ siteName: '', tagline: '', hasLogo: false, hasFavicon: false, version: 0 }`.
- `PUT /branding` without a cookie is `401`; with a `pos` cookie is `403`; with a branch non-owner is `403`.
- Owner `PUT` with `{ siteName: 'Pro Sim', tagline: 'Desk', logo: png, logoDark: null, favicon: png }` answers `200` with `hasLogo: true`, `version > 0`; a following `GET /branding/logo` is `200` with `content-type` `image/png` and the immutable cache header; `GET /branding/logo-dark` answers the light bytes (fallback); `GET /branding/favicon` is `200`.
- Owner `PUT` with every field empty answers `200`, `hasLogo: false`, and `GET /branding/logo` is `404`.
- Owner `PUT` with `logo: 'data:image/jpeg;base64,AAAA'` is `400` with `code: 'INVALID'`.

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement store, service, controller, module; register in `registry.ts`**

In `main.ts`: `NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false })`, then `app.useBodyParser('json', { limit: '1mb' })` and `app.useBodyParser('urlencoded', { extended: true, limit: '1mb' })` before CORS.

- [ ] **Step 4: Run the whole API suite**

Run: `npm run test:api`
Expected: all green, including the new spec.

- [ ] **Step 5: Typecheck** — `npm run typecheck:api`

- [ ] **Step 6: Commit** — `feat(api): public branding read, owner-only branding write`

---

### Task 4: Web API calls and copy keys

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/copy/ar.ts`, `en.ts`, `he.ts`

**Interfaces:**
- Produces:
  - `export type BrandingSummary = { siteName: string; tagline: string; hasLogo: boolean; hasFavicon: boolean; version: number }`
  - `export type BrandingBody = { siteName: string; tagline: string; logo: string | null; logoDark: string | null; favicon: string | null }`
  - `api.branding: () => request<BrandingSummary>('GET', '/branding')`
  - `api.saveBranding: (body: BrandingBody) => request<BrandingSummary>('PUT', '/branding', body)`
  - Copy keys (values below are the Arabic/English; Hebrew follows the same meaning):

| key | ar | en |
|---|---|---|
| navSettings | الإعدادات | Settings |
| navBranding | هوية الموقع | Site identity |
| brandingTitle | هوية الموقع | Site identity |
| brandingLede | الاسم والشعار وأيقونة التبويب التي يراها الجميع في صفحة الدخول وداخل المكتب. | The name, logo and tab icon everyone sees on the sign-in page and in the office. |
| brandingNames | الاسم والوصف | Name and tagline |
| brandingSiteName | اسم الموقع | Site name |
| brandingTagline | الوصف القصير | Tagline |
| brandingImages | الصور | Images |
| brandingImagesHint | PNG أو WebP بخلفية شفافة أفضل. تُصغَّر الصور تلقائياً. | Transparent PNG or WebP works best. Images are resized automatically. |
| brandingLogo | شعار صفحة الدخول | Sign-in logo |
| brandingFavicon | أيقونة التبويب | Browser tab icon |
| brandingChoose | اختر صورة | Choose an image |
| brandingReplace | استبدل الصورة | Replace image |
| brandingDrag | أو اسحبها إلى هنا | or drag it here |
| brandingRemove | إزالة الصورة | Remove image |
| brandingPreview | معاينة مباشرة | Live preview |
| brandingPreviewTab | تبويب المتصفح | Browser tab |
| brandingPreviewSidebar | الشريط الجانبي | Sidebar |
| brandingPreviewLogin | صفحة الدخول | Sign-in page |
| brandingSaved | تم حفظ الهوية | Identity saved |
| brandingTooLarge | الصورة غير مدعومة أو كبيرة جداً (PNG أو WebP، حتى 300 ك.ب بعد التصغير) | The image is not supported or too large (PNG or WebP, up to 300 KB after resizing) |
| saveChanges | حفظ التغييرات | Save changes |
| discardChanges | تجاهل التغييرات | Discard |

- [ ] **Step 1: Add the types and the two calls to `api.ts`**
- [ ] **Step 2: Add the keys to the three copy files**
- [ ] **Step 3: Run `npm run check:copy`** — expected: it reports the new keys as unused (they are used by Tasks 6–8); run it again at the end of Task 8 and expect a clean exit.
- [ ] **Step 4: Commit** — `feat(web): branding api calls and copy`

---

### Task 5: Branding context and server loader

**Files:**
- Create: `apps/web/lib/branding.tsx` (`'use client'`)
- Create: `apps/web/lib/branding-load.ts` (server only)
- Create: `apps/web/tests/unit/branding-load.spec.ts` if a unit runner exists; otherwise the check is a throwaway script under `/tmp` run with `tsx`, and the task notes it.
- Modify: `apps/web/app/layout.tsx`

**Interfaces:**
- Produces:
  - `export type Branding = { name: string; tagline: string; logo: string; logoDark: string; favicon: string; version: number }`
  - `export type BrandingSeed = BrandingSummary` (from `api.ts`)
  - `BrandingProvider({ seed, children })` resolves the seed against `usePrefs().t.brand` / `t.brandSub`; `logo = seed.hasLogo ? `/api/branding/logo?v=${version}` : ''`, likewise `logoDark` (`/api/branding/logo-dark`) and `favicon`.
  - `useBranding(): Branding`.
  - `loadBranding(): Promise<BrandingSeed>` in `branding-load.ts`: `fetch(`${base}/branding`, { cache: 'no-store', signal: AbortSignal.timeout(1500) })` with `base = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001'`; any failure returns `{ siteName: '', tagline: '', hasLogo: false, hasFavicon: false, version: 0 }`.
  - `layout.tsx`: `generateMetadata` reads `loadBranding()`; `title = seed.siteName || copy[locale].brand`; `icons = seed.hasFavicon ? { icon: `/api/branding/favicon?v=${seed.version}` } : undefined`. `RootLayout` loads the seed once and wraps `<Toasts>` content in `<BrandingProvider seed={seed}>` (inside `Preferences`, which supplies `usePrefs`).

- [ ] **Step 1: Write the loader check** — `loadBranding()` with `NEXT_PUBLIC_API_URL=http://127.0.0.1:9` resolves to the default seed in under 2 s.
- [ ] **Step 2: Implement `branding-load.ts`, `branding.tsx`, wire `layout.tsx`**
- [ ] **Step 3: `npm run typecheck:web`** — expected clean.
- [ ] **Step 4: Commit** — `feat(web): branding context loaded in the layout`

---

### Task 6: Sidebar Settings group

**Files:**
- Modify: `apps/web/components/office-shell.tsx:43` (`NavItem`), `:185-191` (Admin group), `:217` (`roots`), `:241-263` (nav render)
- Modify: `apps/web/app/styles/shell.css` (after `.nav-link` rules)

**Interfaces:**
- Consumes: `t.navSettings`, `t.navBranding`; `lucide-react` `Settings`, `Palette`, `ChevronDown`.
- Produces: `type NavGroup = { key: string; label: string; icon: LucideIcon; items: NavItem[] }`; a group's items get the same layer/owner filter as items; `type NavEntry = NavItem | NavGroup` distinguished by `'items' in entry`.

- [ ] **Step 1: Model the group** — Admin section items become `[audit, roles, { key: 'settings', label: t.navSettings, icon: Settings, items: [{ label: t.navBranding, href: '/branding', icon: Palette, layers: ['branch'], owner: true }] }]`. Filtering keeps a group only when it has an item left. `roots` include group item hrefs.
- [ ] **Step 2: Render** — state `openGroups: Record<string, boolean>`; a group is open when `openGroups[key] ?? items.some(active)`. Expanded sidebar and drawer: `<div className="nav-group">` with `<button type="button" className="nav-link nav-group-head" aria-expanded={open} aria-controls={`nav-group-${key}`}>` (icon, `<span>` label, `<ChevronDown className={open ? 'nav-group-chevron open' : 'nav-group-chevron'} />`) and, when open, `<div id=... className="nav-group-body">` with the item links. Compact sidebar: the item links only.
- [ ] **Step 3: Style in `shell.css`** — `.nav-group-head { width: 100%; }`, `.nav-group-chevron { margin-inline-start: auto; width: 14px; height: 14px; }`, `.nav-group-chevron.open { transform: rotate(180deg); }`, `.nav-group-body .nav-link { padding-inline-start: 40px; }` (icon 18px + gap 10px + 12px start padding; read the real `.nav-link` padding and keep the children's icons aligned under the head's label), `.drawer .nav-group-body .nav-link { min-height: 44px; }`.
- [ ] **Step 4: Typecheck and look** — `npm run typecheck:web`; in the browser, Arabic and English, light and dark: the chevron sits at the inline end, the group opens on click, `/branding` highlights it open, the collapsed sidebar shows the Palette icon alone.
- [ ] **Step 5: Commit** — `feat(web): collapsible Settings group in the admin nav`

---

### Task 7: Browser image helpers

**Files:**
- Create: `apps/web/lib/branding-image.ts`
- Test: a throwaway `/tmp` check is not possible for canvas; the dark-variant maths is pure, so split it: `darkTone(r, g, b): [number, number, number] | null` is tested by `apps/web/tests/unit/dark-tone.spec.ts` if a unit runner exists, else by a `/tmp` script with `tsx`.

**Interfaces:**
- Produces:
  - `shrinkImage(file: File, maxSide: number): Promise<string>` — `''` unless `file.type` is `image/png` or `image/webp`; draws to a canvas at most `maxSide` on the longest side; `toDataURL('image/webp', 0.9)`; `''` when the decoded size would exceed 300 000 bytes (base64 length × 3/4).
  - `darkTone(r: number, g: number, b: number): [number, number, number] | null` — the spec rule; `null` when the pixel keeps its colour.
  - `darkVariant(dataUrl: string): Promise<string>` — draws the data URL, maps every pixel with `a > 0` through `darkTone`, returns a webp data URL.
  - `LOGO_SIDE = 768`, `FAVICON_SIDE = 256`.

- [ ] **Step 1: Write the `darkTone` checks** — `darkTone(0, 0, 0)` → `[150, 150, 150]`; `darkTone(255, 255, 255)` → `[255, 255, 255]`; `darkTone(208, 0, 0)` → `null`; `darkTone(40, 42, 45)` → `[167, 167, 167]` (mean 42.33 × 0.42 = 17.78 → 167).
- [ ] **Step 2: Implement**
- [ ] **Step 3: Run the checks, `npm run typecheck:web`**
- [ ] **Step 4: Commit** — `feat(web): logo shrink and dark copy in the browser`

---

### Task 8: Branding page

**Files:**
- Create: `apps/web/app/branding/page.tsx`
- Create: `apps/web/components/branding-drop.tsx`
- Create: `apps/web/components/branding-preview.tsx`
- Modify: `apps/web/app/styles/desk.css` (page compositions section, after `.settings-*`)

**Interfaces:**
- Consumes: `api.branding`, `api.saveBranding`, `useBranding`, `shrinkImage`, `darkVariant`, `useRequireLayer`, `useOffice`, `useLoad`, `useAction`, `useRouter`.
- Produces:
  - `BrandingDrop({ id, title, value, square, onPick(file: File), onClear() })` where `value` is a data URL or URL (`''` for none). Renders `<div className={square ? 'drop-field square' : 'drop-field'}>`: `<span className="drop-title" id={`${id}-label`}>`, `<label className={value ? 'drop has-image' : 'drop'} onDragOver onDrop>` with `<img>` or `<ImageUp>` glyph, `<strong>` (`brandingChoose`/`brandingReplace`), `<small>` (`brandingDrag`), hidden `<input type="file" accept="image/png,image/webp" aria-labelledby>`; and when `value`, `<button type="button" className="secondary">{t.brandingRemove}</button>`.
  - `BrandingPreview({ name, tagline, logo, logoDark, favicon })` renders `aside.brand-preview` with the three mocks; `logo`/`logoDark` are shown through `.brand-logo-light` / `.brand-logo-dark` so `.dark` picks the copy.
  - Page draft state `{ siteName, tagline, logo, logoDark, favicon }` where each image is `''` (none) or a data URL. On load, when `hasLogo`/`hasFavicon`, the page fetches `/api/branding/<kind>?v=` as blobs and converts them to data URLs, so an untouched image is re-sent as it was stored. Save sends `logo: draft.logo || null`, etc.
  - `dirty` = draft differs from the loaded draft; Save disabled unless dirty; Discard restores.
  - After a successful save: `useAction` note `t.brandingSaved`, then `router.refresh()`.
  - Guard: `const allowed = useRequireLayer(['branch']); const { me } = useOffice(); useEffect(() => { if (me && !me.isBranchOwner) router.replace('/'); }, ...)`; render nothing until `allowed && me?.isBranchOwner`.

- [ ] **Step 1: Styles in `desk.css`**

```css
.brand-layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; align-items: start; }
.brand-form { display: grid; gap: 12px; }
.brand-drops { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.drop-field { display: grid; gap: 8px; }
.drop-title { font-size: 13px; color: var(--rd-ink-2); }
.drop { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 12px; min-height: 96px; padding: 12px; border: 1px dashed var(--rd-field); border-radius: var(--rd-radius-lg); background: var(--rd-surface-2); cursor: pointer; }
.drop:hover, .drop:focus-within { border-color: var(--rd-ink); }
.drop-thumb { display: grid; place-items: center; width: 120px; height: 72px; border-radius: 10px; background: var(--rd-surface); border: 1px solid var(--rd-line); overflow: hidden; }
.drop-field.square .drop-thumb { width: 72px; }
.drop-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
.drop-thumb svg { width: 22px; height: 22px; color: var(--rd-muted); }
.drop strong { display: block; font-size: 14px; }
.drop small { color: var(--rd-muted); font-size: 12px; }
.drop input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.brand-foot { display: flex; gap: 8px; justify-content: flex-start; }
.brand-preview { position: sticky; top: 0; display: grid; gap: 12px; }
.brand-preview-label { font-size: 12px; color: var(--rd-muted); }
.bp-browser { border: 1px solid var(--rd-line); border-radius: var(--rd-radius-lg); background: var(--rd-surface); overflow: hidden; box-shadow: var(--rd-shadow-card); }
.bp-tab { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--rd-surface-2); border-bottom: 1px solid var(--rd-line); font-size: 12px; }
.bp-tab-icon { width: 16px; height: 16px; border-radius: 4px; background: var(--rd-primary-bg); overflow: hidden; }
.bp-tab-icon img { width: 100%; height: 100%; object-fit: cover; }
.bp-body { display: grid; grid-template-columns: 120px 1fr; min-height: 120px; }
.bp-side { display: grid; justify-items: center; align-content: start; gap: 6px; padding: 12px 8px; border-inline-end: 1px solid var(--rd-line); text-align: center; }
.bp-side img { max-width: 88px; max-height: 40px; object-fit: contain; }
.bp-mark { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--rd-primary-bg); color: var(--rd-primary-fg); font-weight: 700; }
.bp-name { font-size: 12px; font-weight: 700; }
.bp-tag { font-size: 10px; color: var(--rd-muted); }
.bp-lines { display: grid; gap: 8px; padding: 16px; align-content: start; }
.bp-lines span { height: 8px; border-radius: 99px; background: var(--rd-surface-3); }
.bp-login { display: grid; justify-items: center; gap: 8px; padding: 20px 16px; border: 1px solid var(--rd-line); border-radius: var(--rd-radius-lg); background: var(--rd-surface); box-shadow: var(--rd-shadow-card); }
.bp-login img { max-width: 160px; max-height: 56px; object-fit: contain; }
.bp-login-name { font-weight: 700; }
.bp-field { width: 100%; max-width: 220px; height: 28px; border: 1px solid var(--rd-field); border-radius: 8px; background: var(--rd-surface); }
.bp-btn { width: 100%; max-width: 220px; height: 30px; border-radius: 8px; background: var(--rd-primary-bg); color: var(--rd-primary-fg); display: grid; place-items: center; font-size: 12px; }
.brand-logo-dark { display: none; }
.dark .brand-logo-dark { display: block; }
.dark .brand-logo-light { display: none; }
@media (max-width: 960px) { .brand-layout { grid-template-columns: 1fr; } .brand-preview { position: static; } }
```

(`.brand-logo-light`/`.brand-logo-dark` move to `base.css` in Task 9 because the shell and auth share them; put them there now and not here.)

- [ ] **Step 2: Implement `branding-drop.tsx`, `branding-preview.tsx`, `page.tsx`**
- [ ] **Step 3: Check** — `npm run typecheck:web`; `npm run check:copy` clean; in the browser as the branch owner: drop a PNG, the preview updates before saving, Save enables, the note shows, the sidebar logo changes after refresh; Remove clears; a JPEG shows the error banner. Arabic/English, light/dark, 1440px and a narrow window.
- [ ] **Step 4: Commit** — `feat(web): site identity page`

---

### Task 9: Apply the brand

**Files:**
- Modify: `apps/web/components/office-shell.tsx:230-238` (brand block)
- Modify: `apps/web/app/login/page.tsx:51-55` (lockup)
- Modify: `apps/web/components/auth-frame.tsx:25-30`
- Modify: `apps/web/components/doors.tsx:9`
- Modify: `apps/web/app/styles/base.css` (after `.brand-rule`), `apps/web/app/styles/auth.css` (near `.login-lockup`), `apps/web/app/styles/shell.css` (near `.sidebar .brand-mark`)
- Modify: `DESIGN.md` — one line under "Components": the brand block takes a logo image when one is saved; the sidebar nav may hold one collapsible group (`.nav-group`).

**Interfaces:**
- Consumes: `useBranding()`.
- Produces: `components/brand-logo.tsx` exporting `BrandLogo({ className, onInk }: { className?: string; onInk?: boolean })` that renders two `<img alt="">` (`brand-logo brand-logo-light` and `brand-logo brand-logo-dark`), swapped when `onInk` (the login banner), or `null` when `logo` is `''`.

- [ ] **Step 1: `BrandLogo` and base styles** — `.brand-logo { display: block; max-width: 100%; object-fit: contain; }`, the light/dark toggles from Task 8 moved here.
- [ ] **Step 2: Shell** — in `brand-block`: `logo ? <BrandLogo className="brand-block-logo" /> : <div className="brand-mark">…</div>`; `brand-name` is `branding.name`; `brand-sub` stays `t[door.label]`. `shell.css`: `.sidebar .brand-block-logo, .drawer .brand-block-logo { max-height: 48px; max-width: 160px; }`, `.sidebar.collapsed .brand-block-logo { max-height: 32px; max-width: 40px; }`.
- [ ] **Step 3: Login** — above `<strong>` add `<BrandLogo className="login-logo" onInk />`; `strong` is `branding.name`, `small` is `branding.tagline`. `auth.css`: `.login-logo { max-height: 56px; max-width: 220px; margin-bottom: 10px; }` and the same tablet/desktop steps as `.login-lockup strong`.
- [ ] **Step 4: Auth frame and doors** — auth frame: logo (if any) replaces the `brand-mark` block, `brand-name`/`brand-sub` from branding; `Doors` is a server component and gets `name` as a prop from the layout (`seed.siteName || copy.ar.brand`).
- [ ] **Step 5: Verify** — `npm run typecheck:web`; browser: with a saved logo and without; Arabic and English; light and dark (sidebar swaps copies, login banner swaps the other way); the tab shows the saved name and icon; `/password` frame.
- [ ] **Step 6: Commit** — `feat(web): saved identity on the shell, sign-in, tab and favicon`

---

### Task 10: Final verification

- [ ] `npm run typecheck`, `npm run test:api`, `npm run check:copy`, `npm run lint --workspace web`.
- [ ] Browser pass per `.cursor/rules/direction-theme.mdc` and `screen-size.mdc` on `/branding` and the sidebar: Arabic, English, light, dark, ~1440px and a narrow window.
- [ ] Remove any `/tmp` scripts; nothing throwaway stays in the repo.
