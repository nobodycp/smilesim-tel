# User packages, prices, and line operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A parent (or the branch) turns packages on or off and sets special prices per user, and stops line operations per user; the catalog, the activation form, the line menus, and the wallet debit all use that resolved answer, inherited down the tree.

**Architecture:** One pure module `user-terms.ts` resolves visibility, buy price, floor, and operation stops from plain tree data. `OfficeService` loads the path from the user to the root once per request and asks that module. `PackageOffer` becomes `UserPackage` (hidden + two prices), a new `SellPrice` holds a non-branch parent's default sell price, and `User.deniedOps` holds operation stops. The web gets a tabbed user page (access · packages and prices · line operations), a renamed package-sheet tab backed by the same rows, and a rewired "سعرك" field.

**Tech Stack:** NestJS + Prisma 7 (PostgreSQL), Jest (`npm test` inside `apps/api`), Next.js 16 app router, copy in ar/en/he, Playwright for browser checks.

**Spec:** `docs/superpowers/specs/2026-11-05-user-packages-and-operations-design.md`

## Global Constraints

- Money is agorot `Int`; the web renders it with `Money`. Prices never leave the API as decimals.
- Copy keys live in `apps/web/lib/copy/{ar,en,he}.ts`; `ar` is the type source; `npm run check:copy` must report no new problems (three pre-existing orphans exist: `noticeReply`, `reportConsumption`, `reportFunding`).
- Every new API error code is added to `apps/api/src/errors.ts` and under `errors` in the three copy files.
- Colours only through `--rd-*` tokens in `apps/web/app/styles/tokens.css`; new CSS rules go into `apps/web/app/styles/desk.css`; logical properties only; touch targets ≥ 44px.
- Editors of terms: the direct parent, or the branch layer with the `edit` grant or `isBranchOwner`; impersonation sessions cannot edit (`actor.impersonating`).
- Price fallback order: `UserPackage` → `SellPrice(parent)` → layer column. Branch staff buy at `branchCost`.
- Operation stop keys, in display order: `activate, charge, extend, switch, sim, esim, freeze, disconnect, rename`.
- API tests run as `cd apps/api && npm test -- <file>`; plain `npx jest` fails on ESM.
- Commit after each task; English commit messages; never commit `.env*`.
- Another agent edits the same repo and restarts the API on port 3001; rebuild with `npm run build --workspace api` and start only when the port is free.

## Review Focus

1. A user whose parent is the branch (a main agent) has no `SellPrice` level; the resolver must skip to the layer column and the floor must be `branchCost`. (Task 2 tests.)
2. An old `PackageOffer` row charged both subscription and renewal; after the migration `extend` must debit the same amount as before. (Task 1 migration copies `price` into `renewalPrice`; Task 5 test.)
3. The package sheet "تخصيص سعر" list must not show a user whose only row is `hidden = true` with no price. (Task 7 test.)
4. Bulk "إيقاف الكل" must skip packages already hidden above: writing `hidden = true` there would keep the package hidden on the child after the ancestor lifts its stop, which the parent never chose. (Task 5 test: bulk skips `hiddenAbove` rows.)
5. `switchQuote` must not offer a target package the point of sale cannot see; otherwise a switch bypasses visibility. (Task 5 test.)

---

### Task 1: Schema and migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`User` 10–47, `Package` 150–196, `PackageOffer` 218–227)
- Create: `apps/api/prisma/migrations/20261106000000_user_terms/migration.sql`

**Interfaces:**
- Produces Prisma models `UserPackage { id, userId, packageId, hidden: boolean, price: number | null, renewalPrice: number | null, setById: string, updatedAt }` with `@@unique([packageId, userId])`; `SellPrice { id, ownerId, packageId, price: number, renewalPrice: number | null }` with `@@unique([packageId, ownerId])`; `User.deniedOps: string` default `""`. Relations: `User.packageTerms UserPackage[]`, `User.sellPrices SellPrice[]`, `Package.userTerms UserPackage[]`, `Package.sellPrices SellPrice[]`.

- [ ] **Step 1: Edit `schema.prisma`** — rename model `PackageOffer` → `UserPackage` and add `hidden Boolean @default(false)`, make `price Int?`, add `renewalPrice Int?`, `setById String`, `updatedAt DateTime @updatedAt`. Add model `SellPrice`. Add `deniedOps String @default("")` to `User`. Rename the relation field `User.packageOffers` → `packageTerms`.

- [ ] **Step 2: Write the migration by hand** (not `migrate dev`, so the copy is explicit):

```sql
ALTER TABLE "PackageOffer" RENAME TO "UserPackage";
ALTER TABLE "UserPackage" RENAME CONSTRAINT "PackageOffer_pkey" TO "UserPackage_pkey";
ALTER INDEX "PackageOffer_packageId_userId_key" RENAME TO "UserPackage_packageId_userId_key";
ALTER TABLE "UserPackage" RENAME CONSTRAINT "PackageOffer_packageId_fkey" TO "UserPackage_packageId_fkey";
ALTER TABLE "UserPackage" RENAME CONSTRAINT "PackageOffer_userId_fkey" TO "UserPackage_userId_fkey";
ALTER TABLE "UserPackage"
  ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "renewalPrice" INTEGER,
  ADD COLUMN "setById" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "UserPackage" ALTER COLUMN "price" DROP NOT NULL;
UPDATE "UserPackage" SET "renewalPrice" = "price" WHERE "renewalPrice" IS NULL;
CREATE TABLE "SellPrice" (
  "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "packageId" TEXT NOT NULL,
  "price" INTEGER NOT NULL, "renewalPrice" INTEGER,
  CONSTRAINT "SellPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SellPrice_packageId_ownerId_key" ON "SellPrice"("packageId", "ownerId");
ALTER TABLE "SellPrice" ADD CONSTRAINT "SellPrice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellPrice" ADD CONSTRAINT "SellPrice_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD COLUMN "deniedOps" TEXT NOT NULL DEFAULT '';
```

Check the existing constraint names with `\d "PackageOffer"` on the dev database before relying on the renames above; adjust names to what Postgres reports.

- [ ] **Step 3: Apply and generate** — `cd apps/api && DATABASE_URL='postgresql://smilesim:smilesim@127.0.0.1:5432/smilesim' npx prisma migrate deploy && npm run prisma:generate`. Expected: `1 migration applied`, no drift warning from `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma`.

- [ ] **Step 4: Typecheck the API** — `npx tsc --noEmit -p .` will now fail on `packageOffer` usages in `office.service.ts` (lines ~1984, 2015, 2166, 2180, 2616). Rename them to `userPackage` keeping behaviour; `saveOffer` writes `{ price, renewalPrice: price, setById: actor.id }`. Expected: clean typecheck.

- [ ] **Step 5: Run the full API suite** — `npm test`. Expected: all pass (no behaviour changed).

- [ ] **Step 6: Commit** — `git add apps/api/prisma && git add apps/api/src/modules/office/office.service.ts && git commit -m "feat(api): UserPackage, SellPrice, and User.deniedOps schema"`

---

### Task 2: Pure resolver `user-terms.ts`

**Files:**
- Create: `apps/api/src/modules/office/user-terms.ts`
- Test: `apps/api/src/modules/office/user-terms.spec.ts`

**Interfaces (Produces):**

```ts
export const OP_KEYS = ['activate','charge','extend','switch','sim','esim','freeze','disconnect','rename'] as const;
export type OpKey = (typeof OP_KEYS)[number];
export type PriceKind = 'subscription' | 'renewal';
export type PathNode = { id: string; loginName: string; layer: string; deniedOps: string };   // index 0 = the user, last = root
export type TermRow = { userId: string; hidden: boolean; price: number | null; renewalPrice: number | null };
export type SellRow = { ownerId: string; price: number; renewalPrice: number | null };
export type LayerPrices = { branchCost: number; mainPrice: number; agentPrice: number; posPrice: number;
  renewalBranchCost: number; renewalMainPrice: number; renewalAgentPrice: number; renewalPosPrice: number };

export function parseOps(stored: string): OpKey[];                 // "charge,sim" → ['charge','sim']; unknown keys dropped
export function serializeOps(keys: readonly string[]): string;    // display order, deduped
export function hiddenAbove(path: PathNode[], terms: TermRow[]): string | null;   // login of nearest ancestor (path[1..]) with hidden; null
export function visibleTo(path: PathNode[], terms: TermRow[], pkg: { enabled: boolean; forSale: boolean }): boolean;
export function layerPrice(layer: string, prices: LayerPrices, kind: PriceKind): number;  // branch → branchCost
export function buyPriceFor(path: PathNode[], terms: TermRow[], sells: SellRow[], prices: LayerPrices, kind: PriceKind): number;
export function priceSource(path: PathNode[], terms: TermRow[], sells: SellRow[], kind: PriceKind): 'custom' | 'parent' | 'layer';
export function floorFor(path: PathNode[], terms: TermRow[], sells: SellRow[], prices: LayerPrices, kind: PriceKind): number;
  // = buyPriceFor(path.slice(1), …) when path has a parent; branch user → branchCost
export function deniedOpsFor(path: PathNode[]): Set<OpKey>;
export function deniedAbove(path: PathNode[]): { op: OpKey; login: string }[];   // nearest ancestor per op, excluding the user itself
```

`terms` is the list of `UserPackage` rows for one package across all users; `sells` the `SellPrice` rows for that package.

- [ ] **Step 1: Write the failing tests** in `user-terms.spec.ts` with a fixed path `pos1 → ag1 → ma1 → branch` and prices `{branchCost:2000, mainPrice:2500, agentPrice:3000, posPrice:3500, renewal*: 1800/2200/2700/3200}`:
  - `buyPriceFor` → 3500 with no rows; 3100 with `SellRow(ag1, 3100)`; 2900 with `TermRow(pos1, price 2900)`; renewal 3200 / 2650 / 2800 by the same ladder; for path `ma1 → branch` with no rows → 2500 (parent is branch, no sell level).
  - `priceSource` → `'layer' | 'parent' | 'custom'` for the three cases.
  - `floorFor(pos1 path)` = `buyPriceFor(ag1 path)` → 3000 with no rows; `floorFor(ma1 path)` → 2000.
  - `visibleTo` false when hidden on pos1, on ag1, on ma1; true with none; false when `enabled=false`.
  - `hiddenAbove` → `'ag1'` when both ag1 and ma1 hide (nearest ancestor wins); `'ma1'` when only ma1 hides; `null` when only pos1 hides.
  - `deniedOpsFor` with `ma1.deniedOps='charge'`, `pos1.deniedOps='sim,bogus'` → `Set{'charge','sim'}`; `deniedAbove` → `[{op:'charge', login:'ma1'}]`.
  - `parseOps('sim,bogus,charge')` → `['charge','sim']` (display order); `serializeOps(['sim','charge','sim'])` → `'charge,sim'`.

- [ ] **Step 2: Run** `npm test -- user-terms` → FAIL (module not found).
- [ ] **Step 3: Implement** the functions above. `buyPriceFor`: custom row for `path[0]` → `sells` row where `ownerId === path[1]?.id` and `path[1].layer !== 'branch'` → `layerPrice(path[0].layer)`. `renewal` on a sell row with `renewalPrice === null` falls to the layer column (spec: "`null` falls through to the global column").
- [ ] **Step 4: Run** `npm test -- user-terms` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): pure resolver for user package terms and operation stops"`

---

### Task 3: Service loaders and the `OPERATION_DENIED` code

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` (`accounts()` ~2688, `visibleAccount()` ~2680, add helpers near `buyPrice` 2615)
- Modify: `apps/api/src/errors.ts` (add `OPERATION_DENIED: 'العملية موقوفة على هذا الحساب'`)
- Modify: `apps/web/lib/copy/{ar,en,he}.ts` `errors` block (ar same text; en `'This operation is stopped on this account'`; he `'הפעולה מושבתת בחשבון זה'`)
- Test: `apps/api/src/modules/office/office-errors.spec.ts` (existing error-contract test picks the new code up)

**Interfaces (Produces, private on `OfficeService`):**

```ts
private pathOf(userId: string, accounts: Account[]): PathNode[];                     // user → root, from the loaded accounts list
private async termsFor(packageId: string): Promise<{ terms: TermRow[]; sells: SellRow[] }>;
private async resolveBuyPrice(userId: string, pkg: PackageRowLike, kind: PriceKind): Promise<number>;   // replaces buyPrice()
private canEditTerms(actor: Actor, target: Account): boolean;
```

`Account` (the existing type returned by `accounts()`) must now also carry `deniedOps`; extend its `select`.

- [ ] **Step 1: Add the error code** in `errors.ts` and the three copy files. Run `cd apps/web && node scripts/check-copy.mjs` → only the three pre-existing orphans.
- [ ] **Step 2: Implement the four helpers.** `resolveBuyPrice` loads `accounts()`, `termsFor(pkg.id)`, and calls the pure `buyPriceFor` with `LayerPrices` taken from the package row. Delete the old `buyPrice()` and the unused `priced()` in `office-terms.ts` (and its test case in `office-terms.spec.ts` if present).
- [ ] **Step 3: Replace the five callers** (`activate` ~805, `completeTask` activate ~1425, `extend` ~992, `restartDisconnected` ~2564, `switchQuote` ~2872) with `await this.resolveBuyPrice(posId, pkg, kind)` using the kind column from the spec table. The fallback argument disappears.
- [ ] **Step 4: Typecheck + full suite** — `npx tsc --noEmit -p . && npm test`. Expected: pass; the esim-ops fixture needs `user.findMany`/`userPackage.findMany`/`sellPrice.findMany` stubs returning `[]` plus a `pos1` account with `parentId` — add them to `office()` in `esim-ops.spec.ts`.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): resolve buy price through user terms; add OPERATION_DENIED"`

---

### Task 4: Enforce visibility and operation stops

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` — `packages()` 362–401, `assertRunnable` 2594–2611 (signature gains `denied: Set<OpKey>`), `operationsFor` 2546–2561 (gains `denied`), `requestEsim` 1115, `activate` 766, `switchQuote` 2860, `transferPos` 1906
- Test: `apps/api/src/modules/office/user-terms-service.spec.ts` (new, fixture style of `esim-ops.spec.ts` with a 4-level tree `branch → ma1 → ag1 → pos1`)

**Interfaces:**
- Consumes Task 2 and Task 3 helpers.
- Produces: `packages()` rows gain `price: number`, `renewalPrice: number`, `canActivate: boolean`; `operationsFor(line, denied)`; `assertRunnable(pkg, action, denied)`.

- [ ] **Step 1: Write failing service tests:**
  - `packages()` for pos1 omits a package with `UserPackage(ag1, hidden)`; includes it for ma1.
  - `packages()` for pos1 returns `price` 2900 when `UserPackage(pos1, price 2900)`; `canActivate` false when `ma1.deniedOps='activate'`.
  - `activate` for pos1 of a package hidden on ag1 → `PACKAGE_HIDDEN` (400).
  - `restartDisconnected`/charge for pos1 when `ma1.deniedOps='charge'` → `OPERATION_DENIED` (403); `operations` on the line card omit `'charge'`.
  - `requestEsim` when `pos1.deniedOps='esim'` → `OPERATION_DENIED`.
  - Order: a package with `actionModes.charge='off'` **and** denied → `OPERATION_DENIED` (user stop checked before package mode).
  - `switchQuote` for pos1 does not list a target hidden on ag1.
  - `transferPos(pos1 → ag2)` deletes `UserPackage` rows where `userId = pos1`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `packages()`: load accounts + path once, load all `UserPackage` and `SellPrice` rows in two queries, filter with `visibleTo`, compute `price`/`renewalPrice` via the pure `buyPriceFor`, `canActivate = !denied.has('activate')`. Keep the existing global columns in the response for the branch table. `assertRunnable(pkg, action, denied)`: after `PACKAGE_DISABLED`, `if (denied.has(opKeyOf(action))) fail(403, 'OPERATION_DENIED')` where `unfreeze → freeze`, `reactivate → charge`. Every caller passes `deniedOpsFor(path)` for the line's `posId` (the owner of the line, not the actor — the stop is on the selling account). `transferPos`: inside `runTx`, `tx.userPackage.deleteMany({ where: { userId: pos.id } })`.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): per-user package visibility and operation stops on the run path"`

---

### Task 5: Write endpoints — user packages, user ops, sell prices, custom prices

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` — new public methods; remove `saveOffer` 2157 / `removeOffer` 2174; `packageSheet` 1973 drops `offers`; `setPrice` 467 rewritten
- Modify: `apps/api/src/modules/office/office.controller.ts` — replace routes 230–255 and 272–283; add user routes after 757
- Modify: `apps/api/src/modules/office/office.dto.ts` — replace `OfferBodyDto` 34–40 and `PackagePriceBodyDto` 42–45
- Modify: `apps/api/src/modules/office/activity-log.ts` 35–37 — replace `'offer'` with `'user_package'`, `'user_ops'`, `'sell_price'`
- Test: `user-terms-service.spec.ts` (extend)

**Interfaces (Produces):**

```ts
// service
async userPackages(gate, loginName): Promise<{ summary: { total: number; visible: number; custom: number };
  companies: { code: string; name: string; packages: UserPackageRow[] }[] }>;
async setUserPackage(gate, loginName, code, body: { hidden?: unknown; price?: unknown; renewalPrice?: unknown }): Promise<UserPackageRow>;
async setUserPackagesBulk(gate, loginName, body: { codes?: unknown; hidden?: unknown }): Promise<{ summary }>;
async userOps(gate, loginName): Promise<{ denied: OpKey[]; deniedAbove: { op: OpKey; login: string }[] }>;
async setUserOps(gate, loginName, body: { denied?: unknown }): Promise<same>;
async customPrices(gate, code): Promise<CustomPriceRow[]>;                              // branch only
async setCustomPrice(gate, code, loginName, body: { price?: unknown; renewalPrice?: unknown }): Promise<CustomPriceRow>;
async clearCustomPrice(gate, code, loginName): Promise<{ ok: true }>;
async setSellPrice(gate, code, body: { price?: unknown; renewalPrice?: unknown }): Promise<{ price: number; renewalPrice: number | null }>;

type UserPackageRow = { code; name; dataGb; months; companyCode; hidden; hiddenAbove: string | null;
  parentBuy; parentRenewalBuy; price: number | null; renewalPrice: number | null;
  effective; renewalEffective; source: 'custom' | 'parent' | 'layer' };
type CustomPriceRow = { loginName; nickname; layer; parentLogin; defaultPrice; defaultRenewalPrice; price: number | null; renewalPrice: number | null };

// DTOs
export class UserPackageBodyDto { hidden?: boolean; price?: number | null; renewalPrice?: number | null }
export class UserPackagesBulkBodyDto { codes?: string[]; hidden?: boolean }
export class UserOpsBodyDto { denied?: string[] }
export class CustomPriceBodyDto { price?: number | null; renewalPrice?: number | null }
export class SellPriceBodyDto { price?: number; renewalPrice?: number | null }
```

Routes (controller): `GET users/:loginName/packages`, `PUT users/:loginName/packages/:code`, `PUT users/:loginName/packages`, `GET users/:loginName/ops`, `PUT users/:loginName/ops`, `GET packages/:code/custom-prices`, `PUT packages/:code/custom-prices/:loginName`, `DELETE packages/:code/custom-prices/:loginName`, `PUT sell-prices/:code`. Activity: `user_package` (subjectKind `user`, subjectRef `${login}:${code}`), `user_ops` (subjectRef login), `sell_price` (subjectKind `package`). `PATCH packages/:code/price` and `setPrice` are removed; `editableField` stays for the web table.

One private writer `writeUserPackage(actor, target, pkg, patch)` is shared by `setUserPackage`, `setUserPackagesBulk`, `setCustomPrice`, `clearCustomPrice`: it checks `canEditTerms`, refuses unhiding when `hiddenAbove` (`FORBIDDEN`), checks each non-null price against `floorFor` (`PRICE_BELOW_FLOOR`), upserts, and deletes the row when `hidden=false && price==null && renewalPrice==null`.

- [ ] **Step 1: Write failing tests:**
  - ag1 sets `price 2800` on pos1 while ag1's own buy is 3000 → `PRICE_BELOW_FLOOR`; `3000` passes (zero margin).
  - ma1 (grandparent) setting pos1 → `FORBIDDEN`; branch owner setting pos1 → ok.
  - ag1 unhiding a package hidden on ma1 → `FORBIDDEN`; branch clearing ma1's hide → ok.
  - `setUserPackage(hidden:false, price:null, renewalPrice:null)` on an existing row deletes it (`userPackage.delete` called).
  - `setUserPackagesBulk(codes, hidden:true)` skips codes with `hiddenAbove` and reports `summary.visible` accordingly.
  - `customPrices` lists pos1 with `price 2900` and omits a user whose row is only `hidden`.
  - `clearCustomPrice` keeps `hidden=true` when set and nulls both prices.
  - `setSellPrice` by ag1 below ag1's own buy → `PRICE_BELOW_FLOOR`; by pos1 → `FORBIDDEN`; by branch → `FORBIDDEN`.
  - ag1 `setUserOps({denied:['charge']})` on pos1 ok; ag1 trying to drop `charge` when `ma1.deniedOps='charge'` → `FORBIDDEN`; branch may.
  - An old offer row (`price 3100, renewalPrice 3100`) keeps `extend` debiting 3100 (Review Focus 2).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** service, DTOs, controller, activity actions. `ACTIVITY_ACTIONS` loses `'offer'`; grep the web for `'offer'` in `activity` copy/labels and rename accordingly.
- [ ] **Step 4: Run** `npx tsc --noEmit -p . && npm test` → PASS. `cd apps/web && node scripts/check-copy.mjs` → no new problems.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): user package terms, operation stops, custom and sell price endpoints"`

---

### Task 6: Web API layer and copy

**Files:**
- Modify: `apps/web/lib/api.ts` — remove `saveOffer`/`removeOffer` (210–213), `setPackagePrice` (116) becomes `setSellPrice(code, price, renewalPrice?)` → `PUT /office/sell-prices/:code`; `PackageSheet.offers` (332) removed; add the calls and types below; `PackageRow` gains `price`, `renewalPrice`, `canActivate`
- Modify: `apps/web/lib/copy/{ar,en,he}.ts`
- Create: `apps/web/lib/ops.ts` — `OP_KEYS`, `opLabel(t, key)`, `opDescription(t, key)`

**Interfaces (Produces):**

```ts
api.userPackages(login) → UserPackagesSheet
api.setUserPackage(login, code, body: { hidden?: boolean; price?: number | null; renewalPrice?: number | null }) → UserPackageRow
api.setUserPackagesBulk(login, codes: string[], hidden: boolean) → { summary }
api.userOps(login) → UserOps;  api.setUserOps(login, denied: string[]) → UserOps
api.customPrices(code) → CustomPriceRow[];  api.setCustomPrice(code, login, body) → CustomPriceRow;  api.clearCustomPrice(code, login) → { ok: true }
api.setSellPrice(code, price: number, renewalPrice?: number | null) → { price; renewalPrice }
```

Copy keys (ar / en / he), add once in each file:
`packagesPricesTab` «الرزم والأسعار» / Packages & prices / חבילות ומחירים · `lineOpsTab` «عمليات الأرقام» / Line operations / פעולות על מספרים · `yourBuy` «سعرك» / Your price / המחיר שלך · `hisPrice` «سعره» / Their price / המחיר שלו · `subscriptionShort` «اشتراك» / Subscription / מנוי · `renewalShort` «تجديد» / Renewal / חידוש · `margin` «الهامش» / Margin / רווח · `inherited` «موروث» / Inherited / בירושה · `customPrice` «سعر خاص» / Custom price / מחיר מיוחד · `stoppedAbove` «موقوف من فوق» / Stopped above / מושבת מלמעלה · `stoppedBy` «موقوف من {login}» / Stopped by {login} / מושבת על ידי {login} · `resetDefault` «إرجاع للافتراضي» / Reset to default / איפוס לברירת מחדל · `enableAll` «تشغيل الكل» / Turn all on / הפעל הכל · `disableAll` «إيقاف الكل» / Turn all off / כבה הכל · `termsSummary` «{total} رزمة · {visible} ظاهرة · {custom} بسعر خاص» / {total} packages · {visible} visible · {custom} custom priced / {total} חבילות · {visible} גלויות · {custom} במחיר מיוחד · `allowed` «مسموح» / Allowed / מותר · `stopped` already exists · `activationStopped` «التفعيل موقوف على هذا الحساب.» / Activation is stopped on this account. / ההפעלה מושבתת בחשבון זה. · `saved` exists? if not «تم الحفظ» / Saved / נשמר · nine `opDesc*` one-liners (`opDescActivate` «تفعيل رقم جديد على رزمة» …).
Rename text of `offersTab` → «تخصيص سعر» / Custom prices / התאמת מחיר and `noOffers` → «لا أسعار مخصصة على هذه الرزمة.» / No custom prices on this package. / אין מחירים מיוחדים בחבילה זו.

- [ ] **Step 1: Add types, calls, copy, and `lib/ops.ts`.** Operation labels reuse `actActivate, actCharge, extend, actSwitch, swapSim, requestEsim, freeze, actDisconnect, changeNumber`.
- [ ] **Step 2: Typecheck** `cd apps/web && npx tsc --noEmit -p .` — expect errors only in the three pages Tasks 7–9 rewrite (`providers/[code]/[packageCode]/page.tsx`, `packages/page.tsx`). Leave them for those tasks; do not commit a red typecheck — instead do Step 3 first.
- [ ] **Step 3: Minimal stubs** — in `providers/[code]/[packageCode]/page.tsx` replace `api.saveOffer`/`removeOffer`/`sheet.offers` with the new calls and an empty `customPrices` state loaded on tab open (full UI in Task 8). In `packages/page.tsx` replace `api.setPackagePrice(code, price)` with `api.setSellPrice(code, price)`. Typecheck → clean. `node scripts/check-copy.mjs` → new keys will be orphans until Tasks 7–9 use them; acceptable only inside this task's commit sequence, so **run check:copy at the end of Task 9**, not here.
- [ ] **Step 4: Commit** — `git commit -m "feat(web): api calls and copy for user package terms and operation stops"`

---

### Task 7: User page — tabs, packages & prices, line operations

**Files:**
- Modify: `apps/web/app/users/[login]/page.tsx` (wrap the existing `.pane` from line ~100 into tab 1)
- Create: `apps/web/app/users/[login]/packages-terms.tsx` — `UserPackagesTab({ login, canEdit })`
- Create: `apps/web/app/users/[login]/line-ops.tsx` — `UserOpsTab({ login, canEdit })`
- Create: `apps/web/components/live-switch.tsx` — extract the `.live-switch` button from `providers/[code]/[packageCode]/page.tsx` 358–370 into `LiveSwitch({ id, label, checked, disabled?, onChange })`; reuse it there
- Modify: `apps/web/app/styles/desk.css` — `.terms-group`, `.terms-row`, `.terms-price`, `.op-grid`, `.op-card`
- Test: `apps/web/tests/user-terms.spec.ts` (Playwright with `tests/mock-api.mjs`, same pattern as `tests/detail-desk.spec.ts`)

**Interfaces:** consumes Task 6 calls. `canEdit` = `row.canEdit` from `officeAccount` for the branch; for a non-branch parent the server decides — the tab reads `canEdit` as `true` and shows the API's `FORBIDDEN` through `useAction`.

Layout decisions the implementer cannot infer:
- Tabs: `div.steps[role=tablist]` with three buttons; active tab in `location.hash` (`#access`, `#packages`, `#ops`); default `#access`.
- Packages tab: `FilterBar` (search input, company `select`, summary `span.hint`, two buttons) **directly followed by** `section.pane > div.sheet` so the sheet scrolls. Inside the sheet: one `section.terms-group` per company with `header` (company name + `LiveSwitch` tri-state: `aria-checked="mixed"` when partly hidden) and `div.terms-row` per package.
- Row grid at ≥1100px: `auto 1fr 7rem 16rem 6rem auto` (switch · name/size · سعرك · two `input.terms-price` with `inputMode="numeric"` and labels `subscriptionShort`/`renewalShort` · margin · badge). Below 1100px: switch + name on the first line, prices and margin wrap under the name, badge at the end. Use `@container` or the existing `responsive.css` breakpoint convention.
- Price input shows `price/100` formatted with two decimals; placeholder = inherited effective; saving on `blur`/`Enter` only when the text changed; parse with the existing `parseShekel`. Empty text → `null` (reset). Reset control: small `button.link` with `t.resetDefault`, shown only when `source === 'custom'`.
- Margin = `effective − parentBuy`; `Money` with class `neg` when negative.
- Badges: `source==='custom'` → `badge` «سعر خاص»; `hiddenAbove` → `badge cancelled` + lock icon, switch `disabled`, title `stoppedBy(login)`; else `badge neutral` «موروث».
- Bulk buttons open `Dialog size="confirm"` then call `setUserPackagesBulk` with the filtered codes.
- Ops tab: `section.pane > div.op-grid` `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`; `article.op-card` with icon (lucide: `Power, BatteryCharging, CalendarPlus, ArrowLeftRight, CreditCard, QrCode, Snowflake, PhoneOff, Hash`), `h3` label, `p.hint` description, `LiveSwitch` checked = allowed. Inherited stop: `disabled` + `badge cancelled` `stoppedBy(login)`.

- [ ] **Step 1: Write the Playwright test** `user-terms.spec.ts`: mock `GET /office/users/pos1/packages` with two companies / three packages (one `hiddenAbove:'ma1'`, one `source:'custom'`); assert the three tabs exist, `#packages` shows the summary text, the locked row's switch is `disabled`, the custom row shows «سعر خاص»; toggling an enabled switch issues `PUT /office/users/pos1/packages/<code>` with `{hidden:true}`; `#ops` shows nine cards and the inherited one is disabled with «موقوف من ma1».
- [ ] **Step 2: Run** `npx playwright test tests/user-terms.spec.ts` → FAIL.
- [ ] **Step 3: Implement** the three files, `LiveSwitch`, and the CSS.
- [ ] **Step 4: Run** the test → PASS; `npx tsc --noEmit -p .` clean; `npx eslint app/users components/live-switch.tsx` no errors.
- [ ] **Step 5: Browser check** on `admin.localhost:3000/users/<pos login>#packages` and `#ops`: Arabic and English, light and dark, 1440px and ~900px. Fix wrap or contrast before continuing.
- [ ] **Step 6: Commit** — `git commit -m "feat(web): user page tabs for packages, prices, and line operation stops"`

---

### Task 8: Package sheet tab «تخصيص سعر»

**Files:**
- Modify: `apps/web/app/providers/[code]/[packageCode]/page.tsx` (tab `offers` 458–477, `offerColumns`, `saveOffer` 193–201)

**Interfaces:** consumes `api.customPrices`, `api.setCustomPrice`, `api.clearCustomPrice`; `LiveSwitch` not needed here.

- [ ] **Step 1: Write a Playwright test** in `tests/package-custom-prices.spec.ts` (mock API): the tab label reads «تخصيص سعر»; the table shows the mocked row with default (muted) and custom prices; editing the subscription field and pressing Enter issues `PUT /office/packages/<code>/custom-prices/<login>` with `{price}`; the row menu item «إرجاع للافتراضي» issues `DELETE`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**: add-row gets a second price field (`renewalShort`); table grouped by layer (`layerName`), columns: account, parent, default subscription/renewal (muted `Money`), two inline `input.terms-price`, difference `Money`, `RowMenu` with `{ label: t.resetDefault, icon: 'undo', onClick }`. Load `customPrices` when the tab opens and after every save.
- [ ] **Step 4: Run** test → PASS; typecheck clean.
- [ ] **Step 5: Browser check** both languages/themes on the sheet of one package that has a custom price (set one from Task 7's screen first, confirm it appears here, reset it here, confirm it disappears there).
- [ ] **Step 6: Commit** — `git commit -m "feat(web): custom prices tab on the package sheet"`

---

### Task 9: «سعرك» writes `SellPrice`; POS catalog uses the effective price

**Files:**
- Modify: `apps/web/app/packages/page.tsx` — non-branch table (290–465): first price column becomes the actor's `price` («سعرك» = buy), the editable field writes `setSellPrice`, placeholder shows the layer column; `PosCatalog` (22–162) card price `row.price` (122), hide the activation form when `!row.canActivate` and show `t.activationStopped`
- Test: extend `apps/web/tests/lists-desk.spec.ts` or new `tests/packages-terms.spec.ts`

- [ ] **Step 1: Write the test**: as agent (mock `me.layer='agent'`), the table shows `price` and saving «سعرك» issues `PUT /office/sell-prices/<code>`; as pos, a package with `canActivate:false` shows «التفعيل موقوف على هذا الحساب.» and no activation button; the card shows `price`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test → PASS. `npx tsc --noEmit -p . && npx eslint . && node scripts/check-copy.mjs` → only the three pre-existing orphans.
- [ ] **Step 5: Browser check** as `agent` and `pos` (`agent.localhost:3000/packages`, `pos.localhost:3000/packages`), both themes.
- [ ] **Step 6: Commit** — `git commit -m "feat(web): sell price per owner and effective price in the catalog"`

---

### Task 10: End-to-end verification and docs

**Files:**
- Modify: `docs/superpowers/plans/2026-11-05-user-packages-and-operations.md` (status line), `DESIGN.md` (add `.terms-row`, `.op-card`, `LiveSwitch` to the component list)

- [ ] **Step 1: Full checks** — root: `npm run lint && npm run check:copy && npm run typecheck && npm run test:api && npm run build`. Expected: green except the three known orphans.
- [ ] **Step 2: Live flow in the browser** (dev API with `TRIAL_SEED=true`): as `branch`, open `main` → hide one package and set `charge` stopped; log in as `pos` → the package is absent from the catalog, an active line's menu has no «شحن»; as `main`, open `agent` → the hidden package's switch is locked with «موقوف من فوق»; set a special price on another package for `agent` → `agent`'s `/packages` shows it as «سعرك»; `agent` sets «سعرك» → `pos`'s catalog price changes.
- [ ] **Step 3: Update `DESIGN.md` and mark the plan done.**
- [ ] **Step 4: Commit** — `git commit -m "docs: user packages and operations plan done; DESIGN.md components"`
