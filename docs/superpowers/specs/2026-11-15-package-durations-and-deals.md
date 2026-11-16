# Package durations and deals — spec

Owner, 2026-11-15: several providers with different shapes (Layan, Sky), packages renewable for several
durations at different prices, offers that must not keep numbers under them, periods that cannot be
disconnected, one cost for the whole chain on an offer, and one place to edit per-user exceptions.
The decisions below were agreed with the owner on 2026-11-15 (`docs/project-plan.md`, section 2026-11-15).

Names in code: the home banner already owns `Offer`, so the new concept is **`Deal`** («عرض» in the UI). A
duration row is **`PackageDuration`** («مدة»).

## Today

- One `Package` holds one duration (`months`) and two price ladders: five activation columns and five
  `renewal*` columns. "Renew for another duration" is a second package reached through `PackageRenewal`; the
  renewal moves `Line.packageId` to the target (`sales/rules/periods.ts` `renewOnto`,
  `sales/settlement/task-completion.ts`).
- `Line.packageId` and `Task.packageId` are RESTRICT keys: a package that ever held a number cannot be deleted.
  An offer made as a package therefore stays for ever.
- A number carries its prices in `Line.terms` (`pricing/rules/prices.ts` `LineTerms`: `renewal`,
  `renewalTargets[]`). A renewal debits the snapshot, not the catalog.
- Periods are stored in days on the wallet row (`WalletEntry.periodDays`, `periodEndsAt`), but the helpers are
  month-shaped (`PERIOD_DAYS × months` in `periods.ts`: `periodEnd`, `lastWindow`, `switchOver`, `periodOf`).
- A buy price is `custom ?? parent's SellPrice ?? layer column` (`pricing/rules/user-terms.ts` `buyPriceFor`).
  `UserPackage` holds `hidden`, `price`, `renewalPrice`; `SellPrice` a parent's default to its children.
- Custom-price routes on the package are branch-only (`pricing/terms.service.ts` `customPrices`,
  `setCustomPrice`, `clearCustomPrice`); a parent writes through the user screen (`canEditTerms`).

### Defects found while reading (fixed first, slice D.1)

- **Disconnect can debit.** `refund − DISCONNECT_FEE` is not guarded: on the last day the point of sale is
  debited 0.50 ₪. Short durations would make it common.
- **Running period's cost at disconnect** comes from the number's current terms (`sales/line-pricing.ts`), which
  an early renewal onto another duration has already replaced.
- **Middle layers' profit** is read from live rows with only the point of sale's price frozen
  (`wallets/wallet-ledger.ts` `saleLadder`); its `.catch(() => null)` falls back to today's prices silently.
- `providers/provider-cost.ts` `pricedOp` matches a package by its display name.

## Target

### 1. Three concepts

1. **Package = the plan.** What a number lives on: company, provider, data, run modes, eSIM. No duration and no
   price of its own once the migration ends.
2. **PackageDuration = one duration with its prices.** `unit` (`day` | `month`; a month is 30 days as today),
   `count`, the five layer prices (one ladder: no separate activation set), `noDisconnect`, `forSale` (may start
   a number), `enabled` (may renew), `providerProductCode?`, `position`. Unique per `(packageId, unit, count)`.
   "1, 2 or 3 months at the same monthly price" is a form helper that writes three explicit rows.
3. **Deal = a disposable price on a base package.** Sold as its own item with its own name; the number is
   written on the base package from the first second and the deal's content is copied into `Line.terms`. No
   restricting key points at a deal: it is edited or deleted at any time, numbers finish it from their copy,
   and wallet rows keep its name (`WalletEntry.dealName`).

```
PackageDuration  packageId, unit, count, branchCost, mainPrice, agentPrice, posPrice, subscriberPrice,
                 noDisconnect, forSale, enabled, providerProductCode?, position
Deal             code, name, packageId (the package after the deal), unit, count (first period),
                 branchCost, mainPrice, agentPrice, posPrice, subscriberPrice,
                 forced (bool), renewalPrices Json? (per duration, while priceUntil runs),
                 priceUntil DateTime? (one date for every number), saleFrom?, saleUntil?, enabled,
                 providerProductCode?
DealExclusion    dealId, userId            (Cascade with the deal; inherited down the tree)
DealSellPrice    dealId, ownerId, price    (Cascade; only on a deal that is not forced)
Line             + lockedUntil DateTime?, dealPriceUntil DateTime?
Task             + periodDays?, durationUnit?, durationCount?, dealCode?
WalletEntry      + periodCost Int?, dealName String?
```

`Line.terms` v2: `{ v: 2, packageCode, windowDays, options: [{ unit, count, prices, noDisconnect }],
deal?: { code, name, prices, renewalPrices?, productCode? } }`. `lineTermsOf` reads v1 as one option of
`months` months.

### 2. Renewal

- A renewal names a duration. The price is the number's snapshot for that duration; whether the duration may
  still be bought is read live (`enabled`).
- `GET /v1/lines/:id/renewal-quote` (read-only): each duration with days, price, resulting `endsAt`, whether it
  locks the number and until when, and whether it is a deal price.

### 3. The lock (`Line.lockedUntil`)

One date on the number, written by two things:

- **A deal**: from activation to the end of the deal's first period (owner: «الشهر الأول»).
- **A duration with `noDisconnect`**: from the moment it is bought to the end of that period — also when the
  period starts later, behind a running one.

While `now < lockedUntil`: disconnect and package switch are refused (`LINE_LOCKED`), on the direct path, on the
quote, and again at task completion (`sales/rules/line-state.ts` `assertTaskFits`). Freeze, rename and SIM change
stay allowed. Only the branch overrides. It is separate from `opsLocked` (the transfer block). The renewal
screen warns before paying: "this duration cannot be disconnected; the number stays locked until <date>".

Worked cases (owner):

| Bought | Refund |
|---|---|
| 3 months (locked), then 1 month | the 3 months never; the month only after the 3 months end, for its days left |
| 1 month, then 3 months (locked) | neither: the number is locked from the purchase to the end of the 3 months |

### 4. Deals

- **New activations only, once per number.** A number that was disconnected or lapsed and is restarted pays the
  base price (`restartDisconnected`).
- **A deal cannot be disconnected** during its first period (the lock).
- **After the deal** the number is on its base package. `endDeal(tx, line, now)` — one function, under the line
  lock (ADR 0010), called by the quote, renew, restart and task completion — restamps the base durations at
  that day's prices and clears the deal. From then on the number is like any other number of the package
  (repriced by the existing tool).
- **A deal with held renewal prices** (Sky's Ramadan deal): `priceUntil` is one date for every number. A renewal
  whose new period **starts** before `priceUntil` takes the deal's renewal price; otherwise the base. The
  period's start decides, not the purchase day, so periods cannot be bought ahead at the deal price.
- **Priced under the branch cost**: allowed, with a clear warning to the branch before saving.
- **Chain cost**: the deal has five layer prices and `forced`.
  - `forced`: every layer pays its deal price as written; `DealSellPrice` and custom prices do not apply.
    Writing the same number for main agent, agent and point of sale gives "one cost for the whole chain"
    (a button fills it).
  - not forced: the prices are the default; a main agent or agent may raise the price to the accounts under it
    (`DealSellPrice`, floor = its own deal cost).
  - The point of sale's price to the subscriber stays free in both.
- **Profit** for a number on a deal is computed from the deal snapshot (`ladderOf` with the deal's prices), never
  from live rows; a missing snapshot fails loudly in reports instead of falling back.
- **A deferred task across the deal's end** settles at the price held when it was opened.

### 5. Per-user exceptions

- **Hide a package**: `UserPackage.hidden`, unchanged, inherited down; it hides every duration and deal of it.
  The per-user bulk hide stays on the user screen (it has no package-page equivalent).
- **Exclude from a deal**: `DealExclusion`, same inheritance. An excluded account sells the base package at its
  base price. Exclusion blocks new sales only.
- **Custom price**: per duration, a row only where a price was typed, keyed by a non-null duration id
  (`UserPackage` keeps `hidden` only; its price columns go). No custom price on a deal.
- **One place**: the package page holds durations, deals, special prices and excluded accounts. The user page
  shows that user's excluded packages and special prices read-only, each linking to the package page.
- **Who writes**: the package-page routes are scoped by `canEditTerms` (direct parent, or branch with `edit`)
  and list only accounts the actor may see. A main agent and an agent get a lighter package page for the
  accounts directly under them, with no column above their own.

### 6. Transfer

- A number on a deal keeps the deal price until the deal ends.
- A transfer of a number that is on a deal to an account excluded from that deal, or where the base package is
  hidden, is **refused** with a clear message. After the deal ends the usual transfer rules apply.

### 7. Disconnect with nothing to refund

When the refund is at or below the fee the disconnect is **refused** (`NOTHING_TO_REFUND`: "nothing to refund;
wait for the period to end"): the direct disconnect, its quote, and the opening of its task. No wallet movement is
ever negative under kind `disconnect`.

One case is not refused: a disconnect **task** opened while a refund was due, completed after the days ran down.
The branch has usually disconnected the number at the provider by then, so the task closes, moves no money, and
its entry keeps the provider's cost (the fee is the branch's). Refusing it would leave a number that is off at the
provider and active with us.

### 8. Providers

- `ProviderProduct` (`providers/directory/adapters/provider-adapter.ts`) gains
  `durations[{ code?, unit, count, cost }]`; the simulated adapter gets a Sky-like provider with 5- and 15-day
  durations.
- The catalog stays the source of truth: the provider proposes, the owner confirms and may edit. The provider's
  cost only prefills `branchCost`. Nothing is fetched at sale time.
- A pass on the provider-health timer compares adapter and catalog and writes one notice per change; a withdrawn
  duration stops new sales of it. Prices never change on their own.

## Non-goals

- Fetching renewal options or prices from the provider at sale time; cost-plus formulas.
- A discount or coupon engine, stacked deals, deals on existing numbers (plan 2026-11-08: no separate discount
  system).
- Custom per-user prices on a deal; "only these accounts" lists.
- Calendar months.
- Automatic merging of today's per-duration packages: a manual branch tool, pair by pair, with a preview.
- Renewal dispatch through `ProviderOperation` (ADR 0017 covers activation only today).
- Back-filling old wallet rows.

## Migration

Additive first, each step with the same numbers on screen:

1. One `PackageDuration` per package from `months` and the renewal columns. Packages whose activation ladder
   differs from the renewal ladder are listed for the owner; the old activation columns are dropped last, once
   none differs or each difference became a deal.
2. Per-user prices and `SellPrice` re-keyed to that duration.
3. Merge tool "package X into Y as a duration": rewrites `Line.packageId` and terms under the line lock,
   `UserPackage`, `SellPrice`, `PackageSwitch` and open `Task` rows (`nextPackageId` included, so a deferred
   renewal keeps its target), then removes the `PackageRenewal` rows. A sibling action turns an old offer
   package into a deal.
4. `PackageRenewal`, `Package.months` and the ten price columns are dropped when empty of readers.
   `PackageSwitch` stays: switching is between packages.

## Open

- Does each provider give an offer its own product code? Decided per adapter; the snapshot carries
  `productCode` either way.
