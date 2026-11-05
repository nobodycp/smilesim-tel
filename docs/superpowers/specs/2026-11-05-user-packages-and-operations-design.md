# User packages, prices, and line operations

Each account's parent decides what that account may sell, at what price, and which line operations it may run. The decision is written on the account and inherited down the tree. Today prices are global columns on `Package`, the per-user price (`PackageOffer`) is half wired, and no per-user gate exists on line operations. This spec replaces those three gaps with one model.

This extends `2026-11-05-line-operations-design.md` (the operation catalog and package modes) and `2026-11-01-companies-packages-design.md` (the shelf and the two price chains). It follows the pricing rules in `docs/project-plan.md` §"من يحدد سعر البيع" and §"المشترك".

## Goal

- From the user page, the parent (or the branch) sees every package in the system, turns each one on or off for this user, and sets a special subscription and renewal price for this user.
- From the package sheet, the branch sees every user whose price differs from their default and edits or clears it. Both screens read and write the same row.
- From the user page, the parent (or the branch) stops individual line operations for this user. The stop is inherited by everyone under that user.
- The catalog, the activation form, the line operations list, and the wallet debit all use the same resolved answer. A point of sale sees the price it is charged.

## Decisions

Taken with the owner on 2026-11-05:

1. Editors: the direct parent, and the branch on any account. Anyone else gets `FORBIDDEN`.
2. Price fallback: a special price for the user, else the parent's own default sell price, else the global layer column that exists today.
3. Operation stops cascade: a stop on an agent applies to every account under it, and the agent cannot lift it for them.
4. One slice: packages, prices, and operation stops ship together under one plan.
5. The package sheet tab "المخصصون" becomes "تخصيص سعر" and is the second face of the same data.

## Data

### `UserPackage` (replaces `PackageOffer`)

| Column | Meaning |
|---|---|
| `userId`, `packageId` | unique pair |
| `hidden Boolean @default(false)` | the package is off for this user |
| `price Int?` | special subscription price, agorot; `null` inherits |
| `renewalPrice Int?` | special renewal price, agorot; `null` inherits |
| `setById String` | who wrote the row last |
| `updatedAt` | |

Migration: rename `PackageOffer` to `UserPackage`, add the four columns, copy the old `price` into `price`. Old offers were charged for both subscription and renewal; the migration also copies `price` into `renewalPrice` so no account's renewal changes on deploy.

A row with `hidden = false`, `price = null`, `renewalPrice = null` is deleted, not kept.

### `SellPrice`

| Column | Meaning |
|---|---|
| `ownerId`, `packageId` | unique pair; owner is a `main_agent` or `agent` |
| `price Int` | the owner's default subscription sell price to direct children |
| `renewalPrice Int?` | default renewal sell price; `null` falls through to the global column |

The branch has no `SellPrice` rows. Its defaults are the existing `Package` columns (`mainPrice`, `agentPrice`, `posPrice`, `subscriberPrice` and the renewal set), still edited on the package sheet "الأسعار" tab.

### `User.deniedOps String @default("")`

Comma-separated operation keys, same storage style as `deniedGrants`. Catalog of keys, in display order:

`activate, charge, extend, switch, sim, esim, freeze, disconnect, rename`

`unfreeze` follows `freeze`. `companySwitch` is not in this list; it has no run screen. `refresh` is not in this list; it moves no money and changes no status.

## Resolution rules

One module, `office-terms.ts` or a new `user-terms.ts`, owns these functions. They take plain data and are unit tested.

### Visibility

`visibleTo(userId, packageId)` is true when `package.enabled && package.forSale` and no account on the path from the user up to the root has a `UserPackage` row with `hidden = true` for that package. The branch sees every package.

`hiddenAbove(userId, packageId)` returns the login of the nearest ancestor that hid it, or `null`. The UI shows it as a lock.

### Buy price

`buyPriceFor(userId, packageId, kind)` where kind is `subscription` or `renewal`:

1. `UserPackage(userId, packageId).price` (or `.renewalPrice`) when not null.
2. `SellPrice(parentId, packageId).price` (or `.renewalPrice`) when the parent is not the branch and the row exists.
3. The global column for the user's layer: `mainPrice`, `agentPrice`, or `posPrice` (renewal: `renewalMainPrice`, `renewalAgentPrice`, `renewalPosPrice`).

A branch staff account buys at `branchCost` / `renewalBranchCost`. A point of sale's sell price to the subscriber stays `subscriberPrice` and is out of this spec.

### Floor

When an editor writes a price for user U on package P, the value must be at least `buyPriceFor(parent(U), P, kind)`. For the branch writing a main agent's price the floor is `branchCost`. Below the floor the API fails with the existing `PRICE_BELOW_FLOOR`. Zero margin is allowed.

When an owner writes a `SellPrice`, the value must be at least the owner's own `buyPriceFor`. Same error.

A floor is checked at write time only. A later rise of the parent's buy price does not rewrite children; the finance report shows the negative margin.

### Operation stops

`deniedOpsFor(userId)` is the union of `deniedOps` on the user and on every ancestor. `deniedAbove(userId)` maps each inherited key to the login that set it.

An operation key in the effective set:

- is removed from `operations[]` on the line (`operationsFor`), so the numbers list, the line card, and the activation dialog do not show it;
- is refused by `assertRunnable` and by `requestEsim` with a new code `OPERATION_DENIED` (403), added to `errors.ts` and to `errors` in ar/en/he;
- for `activate`, also hides the activation button on the packages page for that user.

Package mode `off` and user stop are independent. Either one refuses the operation. The order of checks is tree visibility, then user stop, then package mode.

### Editing rights

`canEditTerms(actor, target)`: the actor is the target's parent, or the actor is on the branch layer with the `edit` grant or the owner flag. Impersonation sessions cannot edit terms.

A parent may not unhide a package that an ancestor hid, and may not clear an inherited operation stop. The API refuses with `FORBIDDEN`; the UI shows the control locked.

## Where the answer is used

| Place | Today | After |
|---|---|---|
| `packages()` catalog | all enabled `forSale` packages, global prices | filtered by `visibleTo`; `price`/`renewalPrice` are the caller's `buyPriceFor`; `canActivate` false when `activate` is denied |
| `activate`, `completeTask` activate | `buyPrice()` reads `PackageOffer` | `buyPriceFor(pos, pkg, 'subscription')`; a hidden package fails `PACKAGE_HIDDEN` |
| `extend` | `buyPrice()` | `buyPriceFor(pos, pkg, 'renewal')` |
| `restartDisconnected` (`charge`) | `buyPrice()` with subscription fallback | `buyPriceFor(pos, pkg, 'subscription')` (unchanged meaning, per line-operations spec) |
| `switchQuote` | `buyPrice()` | `buyPriceFor(pos, target, 'renewal')`; a target the pos cannot see is not a switch target |
| `setPrice` ("سعرك" on `/packages` for main agent and agent) | writes the global column | writes `SellPrice` for the actor |
| `operationsFor` | package mode only | package mode and `deniedOpsFor` |
| `transferPos` | moves the parent | also deletes the moved account's `UserPackage` rows; the new parent's defaults apply |

The `buyPrice()` helper is removed. `priced()` in `office-terms.ts`, currently unused, is either used by the new resolver or deleted.

## API

All routes are under `office`, gated by `canEditTerms` unless noted.

| Route | Body | Returns |
|---|---|---|
| `GET users/:login/packages` | — | `{ summary: { total, visible, custom }, companies: [{ code, name, packages: [row] }] }` |
| `PUT users/:login/packages/:code` | `{ hidden?: boolean, price?: number \| null, renewalPrice?: number \| null }` | the updated row |
| `PUT users/:login/packages` | `{ codes: string[], hidden: boolean }` | `{ summary }` |
| `GET users/:login/ops` | — | `{ denied: string[], deniedAbove: { op, login }[] }` |
| `PUT users/:login/ops` | `{ denied: string[] }` | same shape |
| `GET packages/:code/custom-prices` | — (branch) | `[{ loginName, nickname, layer, parentLogin, defaultPrice, defaultRenewalPrice, price, renewalPrice }]` for every user with a non-null special price |
| `PUT packages/:code/custom-prices/:login` | `{ price?: number \| null, renewalPrice?: number \| null }` (branch) | the row |
| `DELETE packages/:code/custom-prices/:login` | — (branch) | clears both prices |
| `PUT sell-prices/:code` | `{ price: number, renewalPrice?: number \| null }` (main agent, agent) | the row |

`row` for the user packages screen:

```
{ code, name, size, companyCode, hidden, hiddenAbove, parentBuy, parentRenewalBuy,
  price, renewalPrice, effective, renewalEffective, source: 'custom' | 'parent' | 'layer' }
```

`PUT packages/:code/offers` and `DELETE packages/:code/offers/:login` are removed with their DTO. `packageSheet` stops returning `offers[]`.

Activity log actions: `user_package` (subject: login + package code), `user_ops`, `sell_price`.

## Screens

### `/users/[login]`

The fact cards stay at the top. Below them a `.steps` row with three tabs: **الصلاحيات** (the existing access board, unchanged), **الرزم والأسعار**, **عمليات الأرقام**. The tab is in the URL hash so a link can open it.

**الرزم والأسعار** is one workbench: `.filter-bar` directly followed by `.pane`, the sheet scrolls.

- Filter bar: name search, company select, a summary line "23 رزمة · 19 ظاهرة · 4 بسعر خاص", and two page-level buttons "تشغيل الكل" / "إيقاف الكل" that act on the filtered set after a `confirm` dialog.
- Sheet: one group per company. The group head has the company name and a tri-state company switch (on, off, mixed). Rows under it.
- Row, start to end: `.live-switch` · package name and size · **سعرك** (parent's buy, muted, `Money`) · **سعره**: two numeric fields, subscription and renewal, placeholder equals the inherited value, with a small "إرجاع للافتراضي" control shown only when a special price exists · **الهامش** `Money`, `--rd-danger` when negative · state badge: *موروث* (`badge neutral`), *سعر خاص* (`badge`), *موقوف من فوق* (`badge cancelled` with a lock icon; the switch is disabled).
- Save is immediate: on switch change, and on blur or Enter in a price field. The row shows a short inline confirmation; the page uses `useAction` for the error banner. No page-level save button, no dialog.
- Wide screen: every column on one line. Narrow: the prices wrap under the name; the switch stays at the start and the badge at the end.

**عمليات الأرقام** is a `.pane` with an `.op-grid`: cards fill the width, 3–4 per row at 1440px, 1–2 in a narrow window. Each card: icon, operation name (reusing `actActivate`, `actCharge`, `extend`, `actSwitch`, `swapSim`, `requestEsim`, `freeze`, `actDisconnect`, `changeNumber`), one line of description, and a `.live-switch` meaning "allowed". A card stopped above shows the switch disabled and a `badge cancelled` "موقوف من {login}". Save is immediate.

### `/providers/[code]/[packageCode]` tab **تخصيص سعر**

Copy key `offersTab` is renamed in meaning: ar "تخصيص سعر", en "Custom prices", he "התאמת מחיר".

- Top: an add row (account picker of non-branch accounts, subscription price, renewal price, save), as today but with two prices.
- Table, grouped by layer: account, parent, default subscription and renewal (muted), special subscription and renewal as inline fields with immediate save, difference `Money`, and a `RowMenu` with "إرجاع للافتراضي" (`undo` icon). Clearing both prices removes the row from the table.
- Empty state reuses `noOffers` with new text "لا أسعار مخصصة على هذه الرزمة."

### `/packages` for main agent and agent

The existing "سعرك" field keeps its place and now writes `SellPrice`. Its placeholder shows the layer column when no `SellPrice` exists. The table shows the actor's own buy price as the first price column.

### Catalog for a point of sale

`PosCatalog` shows `effective` as the card price. Packages hidden for the pos are absent. When `activate` is denied the activation form is absent and the details tab says "التفعيل موقوف على هذا الحساب."

## Styles

New classes live in `desk.css`: `.terms-group`, `.terms-row`, `.terms-price`, `.op-grid`, `.op-card`. Colors come from existing `--rd-*` tokens; no new token is expected. The `.live-switch` from the package sheet is reused. Touch targets stay 44px. Checked in Arabic and English, light and dark, 1440px and a narrow window.

## Tests

Unit (`office-rules.spec.ts` or a new `user-terms.spec.ts`):

- `buyPriceFor` through each of the three levels, subscription and renewal.
- `visibleTo` with a hide on the user, on the parent, on the grandparent, and none.
- `deniedOpsFor` as the union over the path; `deniedAbove` names the right ancestor.
- Floor: equal passes, below fails.

Service (`office` specs, real database):

- A pos does not see a package hidden on its agent; activation of it fails `PACKAGE_HIDDEN`.
- A charge denied on the main agent fails `OPERATION_DENIED` on the pos and is absent from `operations[]`.
- A special subscription price is what the wallet debits on activation; the special renewal price is what `extend` debits.
- A parent writing below its own buy price fails `PRICE_BELOW_FLOOR`.
- `transferPos` deletes the moved account's `UserPackage` rows.
- The migration keeps an old offer's renewal charge unchanged.
- An agent cannot clear a stop set on its main agent; the branch can.

Browser: the three screens above, both languages, both themes, wide and narrow.

## Non-goals

- Reusable price lists shared by several accounts.
- Permissions per package per operation.
- Rewriting prices on existing lines when a special price changes; `reprice-renewal` stays as it is.
- A subscriber-facing price per pos (`subscriberPrice` stays global).
- Stops for `refresh` or `companySwitch`.
