# Transfers by layer and prices on existing numbers — Design

**Date:** 2026-11-06 (revised 2026-11-07: section 9 and the fifth transfer choice)
**Builds on:** `2026-11-05-user-packages-and-operations-design.md` (user terms, operation stops, `user-terms.ts`)

## Goal

Every move in the tree is decided by the layer above the thing that moves, and nobody is ever shown
an account outside their own subtree while choosing a destination. An agent moves numbers between
its own points of sale; a main agent moves numbers and points of sale anywhere inside its chain;
the branch owner, and branch staff whose role allows it, move numbers, points of sale, and whole
agents across chains. The branch can also stop a specific account from transferring at all.

Moving an agent (with its points of sale and their numbers) does not exist today; this spec adds it.

The second half (section 9) fixes one rule for what an existing number pays at renewal: **the
price the number carries**. Writing a price anywhere touches new activations only. Existing
numbers are repriced in one table that groups them by the price they carry today — bring them to
the current price in one press, or give each group its own new price — reached from the package
row on the user page, from the package sheet, and by the branch across the whole system for
provider price changes. The transfer dialog offers the same thing as its fifth choice.

## Vocabulary

- **Chain**: the subtree under one main agent.
- **Inside / outside the chain**: relative to the actor. For an agent "inside" is its own points of
  sale; for a main agent "inside" is its chain; for the branch there is no outside.
- **Own terms** of an account: the `UserPackage` rows (custom prices, hidden packages) and the
  `deniedOps` written *on* that account by its parent or the branch.
- **Child terms** of an agent: the `UserPackage` rows and `deniedOps` on its points of sale, plus
  the agent's own `SellPrice` rows.

## Decisions

### 1. One rule, three grants

The grant says *what* an account may move; the subtree says *how far*.

| Grant | Default holders | Moves |
|-------|-----------------|-------|
| `transferLines` (exists) | agent, main agent, branch owner | a number from one point of sale to another |
| `transferPos` (exists) | main agent, branch owner | a point of sale from one agent to another |
| `transferAgents` (new) | branch owner | an agent, with everything under it, from one main agent to another |

Branch staff hold none by default; a job role grants them. A point of sale holds none.

A transfer is allowed when **all** of these hold:

1. The actor holds the grant and is not impersonating.
2. `transfer` is not stopped on the actor's path (section 3).
3. The thing's **current parent** and the **destination** are both inside the actor's subtree
   (`visibleAccountIds`). The branch sees everything, so this is never a restriction for it.
4. The destination is the right layer (number → point of sale, point of sale → agent, agent →
   main agent), is not frozen, and is not the current parent.

Because of rule 3 an agent can only reach its own points of sale and a main agent only its own
chain; the "inside / outside" distinction needs no extra code or grant.

**Role labels** follow the layer of the role, using the names the office agreed on:

| Layer of the role | `transferLines` | `transferPos` | `transferAgents` |
|-------------------|-----------------|---------------|------------------|
| agent | نقل الأرقام داخل السلسلة | — | — |
| main agent | نقل الأرقام خارج السلسلة | نقل نقاط البيع داخل السلسلة | — |
| branch (layer and job roles) | نقل الأرقام بين السلاسل | نقل نقاط البيع خارج السلسلة | نقل الوكلاء |

A grant that a layer can never use is not shown on that layer's role. English and Hebrew copy
carry the same six labels.

### 2. Moving an account: one endpoint, two kinds, explicit choices

`POST /office/users/:login/transfer` accepts a point of sale or an agent.

```ts
{
  parentLogin: string;                 // the new agent (for a pos) or main agent (for an agent)
  ownPrices: 'keep' | 'reset';         // custom prices + hidden packages on the moved account
  ownStops: 'keep' | 'reset';          // deniedOps on the moved account
  childPrices?: 'keep' | 'reset';      // agent only: UserPackage rows on its points of sale + its SellPrice rows
  childStops?: 'keep' | 'reset';       // agent only: deniedOps on its points of sale
  linePrices: 'keep' | 'recapture';    // renewal prices carried by the moved numbers (section 9)
}
```

All five are required for an agent, `parentLogin`, `ownPrices`, `ownStops`, and `linePrices` for
a point of sale; a missing or unknown value is `INVALID`. There is no default, so the caller always
states what happens.

- `reset` on prices deletes the rows (and, for `childPrices`, the agent's `SellPrice` rows).
  `reset` on stops sets `deniedOps` to empty. `keep` leaves rows untouched.
- `linePrices: 'recapture'` reprices every renewable number under the moved account to
  `'current'` (section 9), **after** the other choices are applied and the parent is changed, so
  the new price is what the number would carry had it been activated today under the new parent.
  `keep` leaves the numbers' terms untouched: they go on paying what they paid.
- Kept custom prices may sit **below the new parent's cost**. The floor is checked at write time
  only (previous spec), so this is allowed; the preview below counts those rows so the person
  moving decides knowingly.
- Numbers follow their point of sale unchanged; a point of sale's lines are stamped with
  `originAgentId` when the point of sale changes agent, exactly as today. Moving an agent does not
  change any line's point of sale, so nothing is stamped.
- Wallets move with their balances. The `ZERO_WALLET_FIRST` rule on point-of-sale transfer is
  removed; its error code and copy key go with it.
- Everything runs in one transaction.

**Preview**: `GET /office/users/:login/transfer-preview?parentLogin=` answers, for the same actor
and rules:

```ts
{
  balance: number;                 // moved account's wallet (agorot)
  subtreeBalance: number;          // agent only: sum of its points of sale
  own:   { customPrices: number; hidden: number; stops: number; belowNewFloor: number };
  child: { customPrices: number; hidden: number; stops: number; sellPrices: number } | null;
  lines: number;                   // numbers under the moved account that can still renew
}
```

`belowNewFloor` is the count of the account's custom prices that are lower than what it would pay
through the new parent. The preview enforces the same authorisation as the transfer, so it is also
how the dialog learns the move would be refused before the user fills the form.

### 3. `transfer` becomes a stoppable operation

`OP_KEYS` gains `transfer` (ten cards on the user page's operations tab, icon `move`). It cascades
down the tree like the others and cannot be lifted below the node that set it.

Unlike the nine line operations, which are judged on the path of the **selling account that owns
the line**, `transfer` is judged on the path of the **actor who moves**. A main agent with the stop
cannot move anything, and neither can its agents, even though their lines are otherwise untouched.
The stop applies to all three kinds of transfer.

### 4. Numbers

`POST /office/lines/:id/transfer` becomes `{ posLogin, linePrices: 'keep' | 'recapture' }` and
gains rules 2–4 of section 1 (rule 3 is already enforced). `keep` leaves the number's terms as they
are; `recapture` reprices it to `'current'` under the new point of sale (section 9). The
number-detail dialog shows the same radio pair as the account transfer dialog.

### 5. Notices and the activity log

Every transfer writes two notices in the same transaction, to the account that lost the thing and
the account that received it:

- `transfer.out` — payload `{ kind: 'line' | 'pos' | 'agent', subject, toLogin, actorName }`
- `transfer.in`  — payload `{ kind, subject, fromLogin, actorName }`

For a number the two accounts are the points of sale; for a point of sale the agents; for an
agent the main agents. `subject` is the msisdn or the login. The shell renders them with the same
action words as the desk («نقل»).

The activity log records `user_transfer` with the moved login as subject and keeps `transfer` on
the line's operation record. The activity table stores no payload; the choices, the two parents,
the balance, and the count of repriced numbers live in the two notices and in the response.

### 6. Screens

- **Users** (`/users`): the row menu shows «نقل» for a point of sale when the actor may move it
  and for an agent when the actor holds `transferAgents` and the agent is in its subtree. One
  `Dialog` (`form` size): destination select limited to allowed parents inside the actor's
  subtree; then the choices as two (point of sale) or four (agent) rows, each a pair of radios
  «تبقى كما هي» / «تتبع السلسلة الجديدة», grouped under «شروط الحساب» and «شروط ما تحته»; then
  one more row «أسعار الأرقام المنقولة» with «تبقى كما هي» / «تُحسب من جديد» and the number of
  lines from the preview; then a preview line built from the preview endpoint (balances, counts,
  and a warning line when `belowNewFloor > 0`); footer with cancel and «نقل». The dialog does not
  open the confirm step until a destination is picked and the preview has answered.
- **Number detail** (`/numbers/[id]`): the existing «نقل» tile and dialog stay and gain the
  «أسعار الرقم: تبقى / تُحسب من جديد» pair; the tile hides when the actor lacks the grant or
  `transfer` is stopped on its path (the server still refuses).
- **User page → operations tab**: tenth card «النقل» — «نقل الأرقام والحسابات من هذا الحساب».
- **Roles**: `transferAgents` added; labels per section 1; grants a layer cannot use are hidden on
  that layer's role form.
- **Notices panel**: two new kinds rendered like the others.

All copy in ar/en/he; `check:copy` must stay green (the removed `ZERO_WALLET_FIRST` key goes from
all three).

### 7. API surface summary

| Method | Path | Change |
|--------|------|--------|
| `POST` | `/office/users/:login/transfer` | accepts agents; new body with `linePrices`; drops the zero-wallet rule; writes notices and audit |
| `GET`  | `/office/users/:login/transfer-preview` | new |
| `POST` | `/office/lines/:id/transfer` | body gains `linePrices`; adds the `transfer` stop check and destination layer/frozen checks |
| `GET`  | `/office/users/:login/ops`, `PUT` same | `transfer` is a valid key |
| `GET`  | `/office/me` | `transferAgents` may appear in `grants`; new `stops: OpKey[]`, the stops on the actor's own path, so the browser can hide «نقل» |
| roles endpoints | | `transferAgents` accepted in `grants` |
| `GET`  | `/office/users/:login/packages` | each row gains `lines: number`, renewable numbers of that package under the user |
| `GET`  | `/office/packages/:code/line-prices?scope=` | new: existing numbers grouped by the renewal price they carry (section 9) |
| `PUT`  | `/office/packages/:code/line-prices` | new: `{ scope, groups: [{ from, to }] }` |
| `POST` | `/office/packages/:code/reprice-renewal` | removed, replaced by the two above |

No schema migration: `deniedOps` and `Role.grants` are strings; `transferAgents` is a new code;
line prices already live in `Line.terms`.

### 8. Rules module

The pure parts live beside `user-terms.ts` in a new `transfer-rules.ts`:

- `transferKind(target)` → `'pos' | 'agent' | null`
- `canTransfer({ actor, grants, actorPath, thingParentId, destination, visible })` → `null | ErrorCode`
- `previewOf(...)` counting rows against the new path with `buyPriceFor`

`OfficeService` loads accounts once per request, as the previous slice established, and asks the
module; the service only performs the writes.

### 9. Existing numbers carry their renewal price

**The rule.** A number pays at renewal the price stored in its own `Line.terms`. Nothing else is
consulted at renewal time. Prices written on accounts — custom prices, sell prices, layer prices —
decide what a *new* activation will carry. An existing number changes only
when a write asks for it.

This replaces today's behaviour, where renewal resolves custom price → parent sell price → the
price frozen on the line, so a custom price reached old numbers automatically. The office decided
it should not: a parent often wants a cheaper activation price for a point of sale without
touching what its running numbers pay.

**Activation.** Every place that captures terms for a number — direct activation, activation
through a branch task, and a package switch — stamps the resolved renewal price into the frozen
ladder: `terms.renewal.posPrice = buyPriceFor(posPath, terms, sells, pkg, 'renewal')`, and each
`terms.renewalTargets[i].renewal.posPrice` the same way for the target package. The subscription
debit is unchanged (already resolved through the path). The other ladder levels (`branchCost`,
`mainPrice`, `agentPrice`) keep coming from the package's layer prices, as today.

**Renewal.** `extend` and a renewal onto a target debit `terms.renewal`; `charge` and
`reactivate` go through `restartDisconnected` and debit the subscription price resolved today
(unchanged by this work). `resolveBuyPrice` loses its `layerFallback` parameter:
it is only ever asked what a new capture would carry.

**Writing a price never touches numbers.** Custom prices, sell prices, and layer prices are saved
exactly as today and reach new activations only. The `hidden` toggle is not a price. Existing
numbers are priced in one place, the table below, and in the transfer dialog's fifth row.

**The table: existing numbers grouped by the price they carry.** For one package and one scope,
the numbers that can still renew (`active` and `frozen`; disconnected ones are left alone) are
grouped by `terms.renewal.posPrice`. The operator sees one row per distinct price with its count
and types a new price per row, or presses one button that fills every row with what a new
activation would pay now. Three office cases, one screen:

- *Bring old numbers to the new price*: press «اتباع السعر الحالي», save.
- *Old numbers at one price, new activations at another*: write the custom price as usual (new
  activations at 35), then in the table set the 45 row to 41.
- *Two groups, two new prices*: set the 41 row to 39 and the 35 row to 37, save.

`GET /office/packages/:code/line-prices?scope=<login | all>` →

```ts
{
  current: number | null;                        // what a new activation would pay for a single-account scope; null for `all`
  groups: { price: number; count: number }[];    // sorted by price
}
```

`PUT /office/packages/:code/line-prices` with `{ scope, groups: [{ from: number; to: number | 'current' }] }`:

- `scope` is a login (that account and everything under it) or `'all'` (branch only).
- A row with `to` equal to `from` or omitted is left alone. `to: 'current'` means the price a
  new activation would carry today for *that number's* point of sale, resolved through its own
  path — so a nearer custom price still wins when an agent runs the table over its subtree.
- A numeric `to` is one flat price for every number in the group. It must not sit below the
  floor of that number's point of sale (what its parent pays at renewal), same rule and same
  `PRICE_BELOW_FLOOR` as a custom price; one offending number refuses the whole save.
- A numeric `to` changes `terms.renewal.posPrice` only; the renewal targets (other packages,
  other prices) are left as they are. `'current'` rebuilds `renewal` and `renewalTargets` from the
  package's current settings, exactly as activation does, with each `posPrice` resolved through
  the number's path; a target removed from the package since the number was activated disappears
  from that number. In both cases `packageCode`, `months`, `windowMonths`, and `subscription` are
  kept.
- One transaction; the response is `{ ok: true, lines: number }` and the toast says
  «تم تحديث {n} رقماً».

**Who.** The actor must see the scope account (`visibleAccountIds`) and must be allowed to write a
custom price on it (its parent, or the branch); `'all'` is branch only (owner or `edit`). A point
of sale cannot open the table.

**Pure part.** `groupLinePrices(lines)` and `repriceLine(line, pkg, targets, to, priceOf)` live in
`office-rules.ts` beside `captureTerms`; `repriceRenewal` and its `which` select are removed. The
service wraps them once, `repriceLines(tx, lineIds, plan)`, loading accounts, terms, and sell rows
once; the transfer (`linePrices: 'recapture'`) calls the same wrapper with every group → `'current'`.

**Screens.**

- User page → packages tab: the package `RowMenu` gains «أسعار الأرقام القائمة» (icon `receipt`),
  shown when the row has at least one renewable number. It opens a `form` `Dialog` titled with
  the package name: a `.data` table (السعر الحالي · عدد الأرقام · السعر الجديد, numeric columns
  `num`, new price is a `PriceField`), a secondary button «اتباع السعر الحالي ({current})» above
  the table, `.empty` when there are no numbers, footer cancel / «حفظ». The toast carries the
  count.
- Package sheet → «تخصيص سعر» tab: the same menu item on each account row opens the same dialog
  with that account as scope.
- Package sheet → the block «سعر التجديد على الأرقام الفعالة» (branch only) becomes a scope
  select («كل النظام» or an account from the users list) and a button «عرض الأرقام» that opens
  the same dialog for that scope. With `all`, the fill button reads «اتباع تسعيرة السلسلة» and
  `current` is per number. This is the path for a company or tax change on the package.
- Transfer dialogs: the fifth row stays as agreed in section 6 and section 4.

Copy in ar/en/he: `linePricesTitle`, `linePricesCurrent`, `linePricesCount`, `linePricesNew`,
`linePricesFollow`, `linePricesFollowChain`, `linePricesScope`, `linePricesAll`, `linePricesOpen`,
`linePricesEmpty`, `linePricesSaved` («تم تحديث {n} رقماً»); `repriceWhich`, `repriceStay` are
removed. The component is one file, `components/line-prices-dialog.tsx`, used by all three screens.

**Audit.** `package_reprice` with the package code as subject (the activity table has no
payload; the count comes back in the response).

## Non-goals

- Moving a main agent (its only parent is the branch).
- Merging accounts, or bulk moves of several numbers at once (later slice, checkbox selection).
- Per-transfer approval flows or tasks; a transfer is immediate.
- Changing who may *see* whom; visibility rules stay as they are.
- A single action that reprices several packages at once for one account; each package is
  written on its own row.
- Repricing the subscription already paid, or any ledger entry; the table changes what the next
  renewal will cost, nothing retroactive.
- A switch on the price forms that reprices existing numbers while saving; the table is the only
  entry (decided 2026-11-07).
- Picking individual numbers inside a price group; a group moves as one.

## Testing

**API (`transfer-rules.spec.ts`, `transfer-service.spec.ts`)**

- Rule matrix: agent moves a number between its own points of sale → ok; to another agent's point
  of sale → `FORBIDDEN`. Main agent across its agents → ok; into another chain → `FORBIDDEN`. Branch
  staff without the grant → `FORBIDDEN`; with the role grant → ok. Impersonation → `FORBIDDEN`.
  Destination frozen, wrong layer, or current parent → `INVALID`.
- `transfer` stopped on the main agent: the main agent and its agents are refused; the branch is
  not.
- Agent move with each `keep`/`reset` combination: which rows remain, `deniedOps` values, the
  agent's `SellPrice` rows, balances unchanged on every wallet, both notices written, audit payload.
- Point-of-sale move with a non-zero wallet succeeds; `originAgentId` stamped as before.
- Preview counts, including `belowNewFloor` when the new parent's cost is above a kept custom
  price; preview refuses what the transfer would refuse.
- `removeUser`/`transferPos` interplay: terms rows deleted by a reset do not resurrect.

**API — section 9 (`office-rules.spec.ts`, `user-terms-service.spec.ts`)**

- Activation under a point of sale with a custom renewal price stamps that price into
  `terms.renewal.posPrice`; a target with its own custom price is stamped too; without rows the
  layer price is stamped as before.
- Renewal reads the line only: writing a custom renewal price after activation does not change the
  next `extend` debit; the table does.
- `groupLinePrices`: 45×100, 41×30, 35×20 come back as three sorted groups; disconnected numbers
  are not counted; frozen ones are.
- `repriceLine` with a number: only `renewal.posPrice` and the matching target entry change;
  `subscription`, `months`, `windowMonths` are kept. With `'current'`: ladder and targets are
  rebuilt from the package, the nearer custom price wins over the parent's sell price, a removed
  target disappears.
- `PUT line-prices`: the three office cases (all → current; 45 → 41 while the custom price is 35;
  41 → 39 and 35 → 37 in one call); a `to` below one number's floor refuses the whole save with
  `PRICE_BELOW_FLOOR` and changes nothing; `scope: 'all'` by a main agent is `FORBIDDEN`; a scope
  outside the actor's subtree is `FORBIDDEN`; a point of sale is `FORBIDDEN`.
- `GET line-prices`: `current` equals `buyPriceFor` on the scope account for a login scope and is
  `null` for `all`.
- Transfer with `linePrices: 'recapture'` prices the moved numbers under the new parent; with
  `keep` their terms are byte-equal before and after.

**Playwright**

- User page packages tab: the row menu item opens the dialog with three groups, «اتباع السعر
  الحالي» fills every new-price field, save sends `{ scope, groups }` and the toast shows the count.
- Package sheet: the block shows scope + «عرض الأرقام» and opens the same dialog with `all`.

- Users page as branch: «نقل» on an agent row opens the dialog, picking a destination fetches the
  preview, four choice rows are shown, the request body carries the four choices.
- Users page as main agent: the destination list holds only its own agents; agent rows have no
  «نقل».
- User page operations tab shows ten cards.
- Roles page: an agent-layer role shows «نقل الأرقام داخل السلسلة» only; a job role shows all three
  branch labels.
