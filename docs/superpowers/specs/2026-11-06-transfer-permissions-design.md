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
price the number carries**. Writing a price anywhere touches new activations; existing numbers
change only when the person writing ticks one switch, «يشمل الأرقام القائمة». The same switch,
with the same meaning, appears on every screen that writes a price, in the transfer dialog, and in
the branch's tool for provider price changes.

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
- `linePrices: 'recapture'` runs the recapture of section 9 over every number under the moved
  account, **after** the other choices are applied and the parent is changed, so the new price is
  what the number would carry had it been activated today under the new parent. `keep` leaves the
  numbers' terms untouched: they go on paying what they paid.
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
are; `recapture` reprices it under the new point of sale (section 9). The number-detail dialog
shows the same switch as everywhere else.

### 5. Notices and the activity log

Every transfer writes two notices in the same transaction, to the account that lost the thing and
the account that received it:

- `transfer.out` — payload `{ kind: 'line' | 'pos' | 'agent', subject, toLogin, actorName }`
- `transfer.in`  — payload `{ kind, subject, fromLogin, actorName }`

For a number the two accounts are the points of sale; for a point of sale the agents; for an
agent the main agents. `subject` is the msisdn or the login. The shell renders them with the same
action words as the desk («نقل»).

The activity log records `user_transfer` (account moves, with the five choices, the two parents,
the moved balance, and the count of repriced numbers in the payload) and keeps `transfer` on the
line's operation record.

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
| `GET`  | `/office/me`, roles endpoints | `transferAgents` in grants |
| `PUT`  | `/office/users/:login/packages/:code`, `DELETE` same | body/query gains `applyToLines` (section 9) |
| `PUT`  | `/office/packages/:code/custom-prices/:login`, `DELETE` same | same |
| `PUT`  | `/office/sell-prices/:code`, `DELETE` same | same |
| `POST` | `/office/packages/:code/reprice-renewal` | body becomes `{ scope: 'all' | login }`; recaptures instead of writing one flat price |

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

**Activation.** `captureTerms` stamps the resolved renewal price into the frozen ladder:
`terms.renewal.posPrice = buyPriceFor(posPath, terms, sells, pkg, 'renewal')`, and each
`terms.renewalTargets[i].renewal.posPrice` the same way for the target package. The subscription
debit is unchanged (already resolved through the path). The other ladder levels (`branchCost`,
`mainPrice`, `agentPrice`) keep coming from the package's layer prices, as today.

**Renewal.** `extend`, `charge`, `reactivate`, and a renewal onto a target read `terms.renewal`
(or the target entry) and nothing else. `resolveBuyPrice(..., 'renewal', layerFallback)` loses
its custom/sell steps whenever a fallback is passed; the subscription path keeps them.

**Recapture** is one pure function, `recaptureRenewal(line, pkg, targets, priceOf)` in
`office-rules.ts`: it rebuilds `renewal` and `renewalTargets` exactly as `captureTerms` would for an
activation today — the package's current layer ladder, the current renewal targets, and `posPrice`
resolved through the number's current point-of-sale path — and keeps `packageCode`, `months`,
`windowMonths`, and `subscription` untouched. It applies to numbers that can still renew
(`active` and `frozen`); disconnected numbers are left alone. The service wraps it once,
`recaptureLines(tx, lineIds)`, loading accounts, terms, and sell rows once and writing every
changed line in the caller's transaction. Every entry point below calls that wrapper; there is no
second repricing path.

**One switch, every write.** Each endpoint that writes or clears a price takes
`applyToLines: boolean` (required on `PUT`, as a query flag on `DELETE`; missing is `INVALID`).
When true, the write recaptures the numbers it reaches, in the same transaction, and the response
carries `{ ..., repricedLines: number }` so the toast can say «تم تحديث 37 رقماً».

| Write | Who | Numbers reached when `applyToLines` |
|-------|-----|-------------------------------------|
| user page → packages tab, price or clear (`PUT`/`DELETE /users/:login/packages/:code`) | parent or branch | numbers of that package whose point of sale is the user or under it |
| package sheet → «تخصيص سعر» (`PUT`/`DELETE /packages/:code/custom-prices/:login`) | branch | same set for that user |
| packages → sell price, set or «إرجاع للافتراضي» (`PUT`/`DELETE /sell-prices/:code`) | agent / main agent | numbers of that package under the owner |
| package sheet → «سعر التجديد على الأرقام الفعالة» (`POST /packages/:code/reprice-renewal`) | branch | numbers of that package in the chosen scope: the whole system or one account's subtree |
| transfer (`linePrices: 'recapture'`) | per section 1 | the moved numbers, all packages |

The `hidden` toggle never reprices; it is not a price.

Because recapture resolves through each number's own path, a nearer custom price still wins: an
agent lowering its sell price with the switch on does not disturb a point of sale that has its own
custom price for that package. A number's price may therefore go up or down; the floor rule is
unchanged (checked only when a price is written on an account).

**The branch tool.** The existing block in the package sheet keeps its title and place. It loses
the «نفس الرزمة / هدف» select and the single price field; it gains a scope select («كل النظام» or
an account picker from `/office/users`) and one button «إعادة احتساب». It is the only place that
reprices without writing an account price, and the way a company or tax change on the package's
layer prices reaches running numbers. Branch only (owner or `edit`), as today.

**Screens.** The switch is `label.check` «يشمل الأرقام القائمة» placed directly under the price
field it belongs to, unchecked each time the form opens. On a `RowMenu` clear («إرجاع للافتراضي»,
«حذف السعر الخاص») the item opens a `confirm` dialog with the same checkbox instead of acting at
once. The transfer dialog shows the same choice as a radio pair (section 6). Copy in ar/en/he:
`applyToLines`, `repricedLines` («تم تحديث {n} رقماً»), `recaptureScope`, `recaptureAll`,
`recaptureRun`; `repriceWhich`, `repriceStay` are removed.

**Audit.** Writes keep their actions (`user_package`, `sell_price`, …) and add `repricedLines` to
the payload. The branch tool records `package_reprice` with `{ code, scope, lines }`.

## Non-goals

- Moving a main agent (its only parent is the branch).
- Merging accounts, or bulk moves of several numbers at once (later slice, checkbox selection).
- Per-transfer approval flows or tasks; a transfer is immediate.
- Changing who may *see* whom; visibility rules stay as they are.
- A single action that reprices several packages at once for one account; each package is
  written on its own row.
- Repricing the subscription already paid, or any ledger entry; recapture changes what the next
  renewal will cost, nothing retroactive.
- Showing a count on the switch before saving; the count comes back with the response.

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
  next `extend` debit; writing it with `applyToLines: true` does, and the response says how many.
- `recaptureRenewal`: rebuilds ladder and targets from the current package, keeps `subscription`,
  `months`, `windowMonths`; the nearer custom price wins over the parent's sell price; frozen
  numbers are repriced, disconnected ones are not.
- Sell-price set and clear with the switch reach only numbers under the owner; the custom-price
  clear with the switch sends numbers back to the parent's sell price.
- Branch tool: `scope: 'all'` touches every renewable number of the package; `scope: <login>` only
  that subtree; a non-branch actor is refused; `applyToLines` missing on a price write is `INVALID`.
- Transfer with `linePrices: 'recapture'` prices the moved numbers under the new parent; with
  `keep` their terms are byte-equal before and after.

**Playwright**

- User page packages tab: saving a price with the switch sends `applyToLines: true` and the toast
  shows the count; «إرجاع للافتراضي» opens the confirm with the checkbox.
- Package sheet: the tool block shows scope + «إعادة احتساب» and posts `{ scope }`.

- Users page as branch: «نقل» on an agent row opens the dialog, picking a destination fetches the
  preview, four choice rows are shown, the request body carries the four choices.
- Users page as main agent: the destination list holds only its own agents; agent rows have no
  «نقل».
- User page operations tab shows ten cards.
- Roles page: an agent-layer role shows «نقل الأرقام داخل السلسلة» only; a job role shows all three
  branch labels.
