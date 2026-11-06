# Transfers by layer: numbers, points of sale, and agents — Design

**Date:** 2026-11-06
**Builds on:** `2026-11-05-user-packages-and-operations-design.md` (user terms, operation stops, `user-terms.ts`)

## Goal

Every move in the tree is decided by the layer above the thing that moves, and nobody is ever shown
an account outside their own subtree while choosing a destination. An agent moves numbers between
its own points of sale; a main agent moves numbers and points of sale anywhere inside its chain;
the branch owner, and branch staff whose role allows it, move numbers, points of sale, and whole
agents across chains. The branch can also stop a specific account from transferring at all.

Moving an agent (with its points of sale and their numbers) does not exist today; this spec adds it.

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
}
```

All four are required for an agent, the first two for a point of sale; a missing or unknown value
is `INVALID`. There is no default, so the caller always states what happens.

- `reset` on prices deletes the rows (and, for `childPrices`, the agent's `SellPrice` rows).
  `reset` on stops sets `deniedOps` to empty. `keep` leaves rows untouched.
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

`POST /office/lines/:id/transfer` keeps its body (`{ posLogin }`) and gains rules 2–4 of section 1
(rule 3 is already enforced). The line keeps its frozen terms; renewal is priced from the new point
of sale's path, as today. No choices are offered.

### 5. Notices and the activity log

Every transfer writes two notices in the same transaction, to the account that lost the thing and
the account that received it:

- `transfer.out` — payload `{ kind: 'line' | 'pos' | 'agent', subject, toLogin, actorName }`
- `transfer.in`  — payload `{ kind, subject, fromLogin, actorName }`

For a number the two accounts are the points of sale; for a point of sale the agents; for an
agent the main agents. `subject` is the msisdn or the login. The shell renders them with the same
action words as the desk («نقل»).

The activity log records `user_transfer` (account moves, with the four choices, the two parents,
and the moved balance in the payload) and keeps `transfer` on the line's operation record.

### 6. Screens

- **Users** (`/users`): the row menu shows «نقل» for a point of sale when the actor may move it
  and for an agent when the actor holds `transferAgents` and the agent is in its subtree. One
  `Dialog` (`form` size): destination select limited to allowed parents inside the actor's
  subtree; then the choices as two (point of sale) or four (agent) rows, each a pair of radios
  «تبقى كما هي» / «تتبع السلسلة الجديدة», grouped under «شروط الحساب» and «شروط ما تحته»; then a
  preview line built from the preview endpoint (balances, counts, and a warning line when
  `belowNewFloor > 0`); footer with cancel and «نقل». The dialog does not open the confirm step
  until a destination is picked and the preview has answered.
- **Number detail** (`/numbers/[id]`): the existing «نقل» tile and dialog stay; the tile hides when
  the actor lacks the grant or `transfer` is stopped on its path (the server still refuses).
- **User page → operations tab**: tenth card «النقل» — «نقل الأرقام والحسابات من هذا الحساب».
- **Roles**: `transferAgents` added; labels per section 1; grants a layer cannot use are hidden on
  that layer's role form.
- **Notices panel**: two new kinds rendered like the others.

All copy in ar/en/he; `check:copy` must stay green (the removed `ZERO_WALLET_FIRST` key goes from
all three).

### 7. API surface summary

| Method | Path | Change |
|--------|------|--------|
| `POST` | `/office/users/:login/transfer` | accepts agents; new body; drops the zero-wallet rule; writes notices and audit |
| `GET`  | `/office/users/:login/transfer-preview` | new |
| `POST` | `/office/lines/:id/transfer` | adds the `transfer` stop check and destination layer/frozen checks |
| `GET`  | `/office/users/:login/ops`, `PUT` same | `transfer` is a valid key |
| `GET`  | `/office/me`, roles endpoints | `transferAgents` in grants |

No schema migration: `deniedOps` and `Role.grants` are strings; `transferAgents` is a new code.

### 8. Rules module

The pure parts live beside `user-terms.ts` in a new `transfer-rules.ts`:

- `transferKind(target)` → `'pos' | 'agent' | null`
- `canTransfer({ actor, grants, actorPath, thingParentId, destination, visible })` → `null | ErrorCode`
- `previewOf(...)` counting rows against the new path with `buyPriceFor`

`OfficeService` loads accounts once per request, as the previous slice established, and asks the
module; the service only performs the writes.

## Non-goals

- Moving a main agent (its only parent is the branch).
- Merging accounts, bulk moves of several numbers at once, or repricing existing lines on move.
- Per-transfer approval flows or tasks; a transfer is immediate.
- Changing who may *see* whom; visibility rules stay as they are.

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

**Playwright**

- Users page as branch: «نقل» on an agent row opens the dialog, picking a destination fetches the
  preview, four choice rows are shown, the request body carries the four choices.
- Users page as main agent: the destination list holds only its own agents; agent rows have no
  «نقل».
- User page operations tab shows ten cards.
- Roles page: an agent-layer role shows «نقل الأرقام داخل السلسلة» only; a job role shows all three
  branch labels.
