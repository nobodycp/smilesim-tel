# Transfers by Layer and Prices on Existing Numbers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A number pays at renewal the price it carries; one grouped table reprices existing numbers; and points of sale, agents, and numbers move inside the tree under one rule with explicit choices for what travels with them.

**Architecture:** Two pure modules beside `user-terms.ts` hold every decision (`line-prices.ts` for stamping, grouping, and repricing a number's frozen terms; `transfer-rules.ts` for who may move what where). `OfficeService` loads accounts, terms, and sell rows once per request, asks the modules, and writes in one transaction. The web adds one dialog component per concern (`line-prices-dialog.tsx`, `transfer-dialog.tsx`) and mounts them from the screens that already exist.

**Tech Stack:** NestJS + Prisma 7 (`apps/api`), Next.js 16 app router (`apps/web`), Jest ESM with the in-memory Prisma stand-in from `user-terms-service.spec.ts` (`tree()`), Playwright with `tests/desk.ts` (`serveOffice`).

**Spec:** `docs/superpowers/specs/2026-11-06-transfer-permissions-design.md`

## Global Constraints

- Chat in Arabic; code, identifiers, commits, and this document in English.
- Copy keys exist in `apps/web/lib/copy/ar.ts`, `en.ts`, `he.ts` together; `npm run check:copy` must stay green (no orphan or missing keys).
- No raw hex, no `rgba()`, no new CSS class for one screen; only `--rd-*` tokens and the classes in `DESIGN.md` (`.data`, `.num`, `.badge`, `label.check`, `.empty`, `Dialog` sizes `confirm` / `form` / `wide`, `RowMenu`).
- Logical properties only (`inset-inline-end`, `padding-inline`); Arabic, English, Hebrew, light and dark checked before a screen is called done.
- API tests: `cd apps/api && npm test -- --runInBand`. Playwright: `cd apps/web && env -u PLAYWRIGHT_BROWSERS_PATH npx playwright test <file> --reporter=line --output /tmp/pw-<name>` (never `rm -rf test-results` in the same command).
- Before each commit: `npm run typecheck`. Before the final push: `npm run lint`, `npm run check:copy`, `npm run typecheck`, `npm run test:api`, `npm run build`; after the push watch `gh run list --limit 3` → `gh run watch <id>` and report id + conclusion.
- Never stage `.env*`, dumps, `.deploy/`, `apps/web/tsconfig.json` auto-edits, or another agent's files (`apps/web/lib/office-session.tsx`, `docs/superpowers/specs/2026-11-06-service-outage-states.md` are currently dirty and not ours).
- Spec values are in agorot: 45 ₪ = 4500. The `tree()` fixture prices: pos activation 3500, pos renewal 3200, agent renewal 2700, main renewal 2200, branch renewal cost 1800.

## Review Focus

1. A number whose `terms.renewal.posPrice` was written by the old `reprice-renewal` tool (flat price, no custom row) must group and reprice like any other — the table reads the line, never the account rows (Task 1 `groupLinePrices` test with three distinct prices, Task 5 PUT test).
2. A point of sale with its own custom renewal price under an agent that runs the table with `'current'` must keep its custom price (Task 5 test "nearer custom price wins").
3. A transfer with `linePrices: 'recapture'` must price under the **new** parent, so the parent change is written before recapture runs in the same transaction (Task 10 test asserts the stamped price equals the new agent's sell price).
4. A main agent moving an agent that is not under it, or to a main agent it cannot see, must get `FORBIDDEN`, and the preview must refuse the same (Task 8 matrix, Task 9 preview-refuses test).
5. The user page's ops tab must show the tenth card and the numbers page must hide «نقل» when `transfer` is stopped on the actor's path even though the grant is present (Task 7 `me.stops` test, Task 13 Playwright).

---

## Part A — Existing numbers carry their renewal price

### Task 1: Pure module `line-prices.ts`

**Files:**
- Create: `apps/api/src/modules/office/line-prices.ts`
- Create: `apps/api/src/modules/office/line-prices.spec.ts`

**Interfaces:**
- Consumes: `LineTerms`, `PackageTerms`, `captureTerms` from `./office-rules`.
- Produces:
  - `export const RENEWABLE_STATUSES = ['active', 'frozen'] as const;`
  - `export function stampRenewal(terms: LineTerms, priceOf: (packageCode: string) => number | null): LineTerms` — returns a copy where `renewal.posPrice = priceOf(terms.packageCode) ?? terms.renewal.posPrice` and each `renewalTargets[i].renewal.posPrice = priceOf(target.code) ?? target.renewal.posPrice`. Nothing else changes.
  - `export type PriceGroup = { price: number; count: number };`
  - `export function groupLinePrices(lines: { terms: LineTerms }[]): PriceGroup[]` — grouped by `terms.renewal.posPrice`, sorted ascending by price.
  - `export type RepricePlan = { to: number } | { to: 'current'; fresh: LineTerms };`
  - `export function repriceLine(line: LineTerms, plan: RepricePlan): LineTerms` — numeric: copy with `renewal.posPrice = to`; `'current'`: `{ ...fresh, packageCode: line.packageCode, months: line.months, windowMonths: line.windowMonths, subscription: line.subscription }`.
  - `export function groupChanges(groups: unknown): { from: number; to: number | 'current' }[] | null` — validates the request body: array, each `from` a non-negative integer, each `to` either `'current'` or a non-negative integer, rows where `to === from` dropped; `null` on any bad shape.

- [ ] **Step 1: Write the failing tests** in `line-prices.spec.ts` using `captureTerms(packageTermsOf(...))` fixtures like `office-rules.spec.ts` does:

```ts
it('stamps the resolved renewal price into the ladder and the targets, nothing else', () => {
  const stamped = stampRenewal(terms, (code) => (code === 'a-300' ? 4100 : code === 'a-600' ? 5900 : null));
  expect(stamped.renewal.posPrice).toBe(4100);
  expect(stamped.renewalTargets[0].renewal.posPrice).toBe(5900);
  expect(stamped.renewal.branchCost).toBe(terms.renewal.branchCost);
  expect(stamped.subscription).toEqual(terms.subscription);
  expect(stampRenewal(terms, () => null)).toEqual(terms);
});
it('groups numbers by the renewal price they carry, lowest first', () => {
  const at = (posPrice: number) => ({ terms: { ...terms, renewal: { ...terms.renewal, posPrice } } });
  expect(groupLinePrices([at(4500), at(3500), at(4500), at(4100)])).toEqual([
    { price: 3500, count: 1 }, { price: 4100, count: 1 }, { price: 4500, count: 2 },
  ]);
  expect(groupLinePrices([])).toEqual([]);
});
it('a numeric plan changes the renewal pos price only', () => {
  const next = repriceLine(terms, { to: 4100 });
  expect(next.renewal.posPrice).toBe(4100);
  expect(next.renewalTargets).toEqual(terms.renewalTargets);
  expect(next.subscription).toEqual(terms.subscription);
});
it('a current plan takes the fresh ladder and targets but keeps identity, window, and subscription', () => {
  const fresh = { ...captureTerms(newer, [newTarget]), renewal: { ...newer.renewal, posPrice: 3700 } };
  const next = repriceLine({ ...terms, windowMonths: 3 }, { to: 'current', fresh });
  expect(next).toEqual({ ...fresh, packageCode: terms.packageCode, months: terms.months, windowMonths: 3, subscription: terms.subscription });
});
it('validates group changes and drops no-ops', () => {
  expect(groupChanges([{ from: 4500, to: 4100 }, { from: 3500, to: 3500 }, { from: 4100, to: 'current' }]))
    .toEqual([{ from: 4500, to: 4100 }, { from: 4100, to: 'current' }]);
  expect(groupChanges([{ from: 4500, to: -1 }])).toBeNull();
  expect(groupChanges([{ from: '45', to: 4100 }])).toBeNull();
  expect(groupChanges('x')).toBeNull();
});
```

- [ ] **Step 2: Run** `cd apps/api && npm test -- --runInBand line-prices` — FAIL: module not found.
- [ ] **Step 3: Implement** `line-prices.ts` with the signatures above.
- [ ] **Step 4: Run** `npm test -- --runInBand line-prices` and `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): line-prices module — stamp, group, reprice frozen renewal terms`

### Task 2: Every capture stamps the resolved renewal price

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` — `activate` (~L876-878), task completion activate (~L1483-1486), `switchPackage` (~L1011-1017) and `switchQuote` (~L3214-3216)
- Test: `apps/api/src/modules/office/user-terms-service.spec.ts`

**Interfaces:**
- Consumes: `stampRenewal` (Task 1); `buyPriceFor`, `PathNode`, `TermRow`, `SellRow` from `./user-terms`; `this.pathOf`, `this.accounts`.
- Produces (private on `OfficeService`):
  - `private async stampFor(terms: LineTerms, posId: string, known?: PathNode[], db: Prisma.TransactionClient | PrismaClient = this.prisma): Promise<LineTerms>` — path = `known ?? this.pathOf(posId, await this.accounts())`; loads the packages whose codes are `terms.packageCode` and every `renewalTargets[i].code` (`db.package.findMany({ where: { code: { in } } })`), then `userPackage.findMany({ where: { packageId: { in: ids }, userId: { in: pathIds } } })` and `sellPrice.findMany({ where: { packageId: { in: ids }, ownerId: { in: pathIds } } })`, and returns `stampRenewal(terms, (code) => pkg ? buyPriceFor(path, termsOf(pkg.id), sellsOf(pkg.id), pkg, 'renewal') : null)`. With an empty path (unknown pos) it returns `terms` unchanged.

- [ ] **Step 1: Write the failing tests** (`describe('capturing the renewal price')`):

```ts
it('activation stamps the custom renewal price, else the parent sell price, else the layer price', async () => {
  const custom = await tree();
  custom.userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: null, renewalPrice: 3100 });
  await custom.service.activate(custom.gates.pos1, { packageCode: 'alloha-150', posLogin: 'pos1', iccid: '8997202000000000002', outcome: 'success' });
  expect((custom.lines[1].terms as LineTerms).renewal.posPrice).toBe(3100);
  const sold = await tree();
  sold.sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3700, renewalPrice: 3400 });
  await sold.service.activate(sold.gates.pos1, { ... iccid: '8997202000000000003' ... });
  expect((sold.lines[1].terms as LineTerms).renewal.posPrice).toBe(3400);
  const plain = await tree();
  await plain.service.activate(plain.gates.pos1, { ... iccid: '8997202000000000004' ... });
  expect((plain.lines[1].terms as LineTerms).renewal.posPrice).toBe(3200);
});
it('a switch stamps the target renewal price through the path and debits from it', async () => {
  const { service, gates, userPackages, line, lines } = await tree();
  userPackages.push({ id: 'r1', packageId: 'pb', userId: 'pos1', hidden: false, price: null, renewalPrice: 3000 });
  line.endsAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
  await service.switchPackage(gates.pos1, 'ln1', { packageCode: 'alloha-400', outcome: 'success' });
  expect((lines[0].terms as LineTerms).renewal.posPrice).toBe(3000);
});
```

The `tree()` mock needs `package.findMany` to honour `where.code.in` (today it returns all; filter with `whereMatch` on `code`) and `line.findMany` to honour `where` (same). Make both changes in the fixture.

- [ ] **Step 2: Run** `npm test -- --runInBand user-terms-service` — the two new tests FAIL (`renewal.posPrice` is 3200 / 3200).
- [ ] **Step 3: Implement** `stampFor` and call it: in `activate`, `const terms = await this.stampFor(captureTerms(...), pos.id, posPath)`; in the task-completion activate branch, `await this.stampFor(captureTerms(...), task.posId, undefined, tx)`; in `switchPackage`, after `switchOnto` succeeds, `const stamped = await this.stampFor(switched.terms, line.posId, line.posPath)` and write `stamped` to the line. In `switchQuote`, replace `resolveBuyPrice(line.posId, target, 'renewal', nextTerms.renewal.posPrice)` with `resolveBuyPrice(line.posId, target, 'renewal')` (full ladder, no fallback) — this is the stamped value by construction.
- [ ] **Step 4: Run** `npm test -- --runInBand user-terms-service esim-ops response-shape` — PASS.
- [ ] **Step 5: Commit** `feat(api): stamp the resolved renewal price into every captured line`

### Task 3: Renewal reads the line only

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` — `extend` (~L1066), `resolveBuyPrice` (~L2936-2957), `repriceActiveRenewal` (~L2160-2187, delete), import of `repriceRenewal` (L50, delete)
- Modify: `apps/api/src/modules/office/office.controller.ts:191-203` (delete the `reprice-renewal` route), `office.dto.ts:26-32` (delete `RepriceRenewalBodyDto`)
- Modify: `apps/api/src/modules/office/office-rules.ts:233-249` (delete `repriceRenewal`), `office-rules.spec.ts:20,222-231` (delete its test and import)
- Modify: `apps/api/src/modules/office/response-shape.spec.ts:~305-332` (delete the `repriceActiveRenewal` tests)
- Test: `apps/api/src/modules/office/user-terms-service.spec.ts:415-421`

**Interfaces:**
- Produces: `private async resolveBuyPrice(userId: string, pkg: { id: string } & LayerPrices, kind: PriceKind, known?: PathNode[]): Promise<number>` — the `layerFallback` parameter and the `pinned` branch are gone; callers that passed `undefined, posPath` now pass `posPath`.

- [ ] **Step 1: Flip the existing test** at L415 to the new rule and add its sibling:

```ts
it('a custom renewal price written after activation does not change what the number pays', async () => {
  const { service, gates, userPackages, line, entries } = await tree();
  userPackages.push(row('pos1', { price: 3100, renewalPrice: 3100 }));
  line.endsAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
  await service.extend(gates.pos1, 'ln1', { outcome: 'success' });
  expect(entries[0]).toMatchObject({ kind: 'extend', amount: -3200 });
});
```

- [ ] **Step 2: Run** `npm test -- --runInBand user-terms-service` — FAIL (`-3100`).
- [ ] **Step 3: Implement**: in `extend`, `const posDelta = -renewal.debit;`. Remove `layerFallback` from `resolveBuyPrice` and update its five callers (`activate`, task activate, `restartDisconnected`, `switchQuote`, and the removed extend call). Delete `repriceActiveRenewal`, its controller route, DTO, `repriceRenewal` in `office-rules.ts`, and the tests of both.
- [ ] **Step 4: Run** `npm test -- --runInBand` and `npm run typecheck` (API) — PASS.
- [ ] **Step 5: Commit** `feat(api): renewal debits the price the number carries; drop flat reprice tool`

### Task 4: Reprice wrapper and the `GET line-prices` read

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` (new methods near `customPrices`, ~L2321)
- Modify: `apps/api/src/modules/office/office.controller.ts` (new route next to `custom-prices`, ~L250-280)
- Test: `apps/api/src/modules/office/user-terms-service.spec.ts`

**Interfaces:**
- Consumes: `groupLinePrices`, `RENEWABLE_STATUSES`, `repriceLine`, `RepricePlan` (Task 1); `stampFor` (Task 2); `visibleAccountIds`, `canEditTerms`.
- Produces:
  - `type LineScope = { kind: 'all' } | { kind: 'account'; id: string; loginName: string; layer: string }`
  - `private async lineScope(actor: Actor, accounts: Account[], scope: unknown): Promise<LineScope>` — `'all'` → branch only (`isBranchOwner || grants.includes('edit')`) else `FORBIDDEN`; a login → the account must exist (`NOT_FOUND`), not be a branch account (`INVALID`), be in `visibleAccountIds(actor...)` and `canEditTerms(actor, target)` else `FORBIDDEN`; a pos actor is always `FORBIDDEN`; anything else `INVALID`.
  - `private scopeLineWhere(scope: LineScope, accounts: Account[], packageId: string)` → `{ packageId, status: { in: RENEWABLE_STATUSES }, ...(scope.kind === 'account' ? { posId: { in: [...visibleAccountIds(scope.id, scope.layer, accounts)] } } : {}) }`.
  - `async linePrices(gate: Gate, code: string, query: { scope?: unknown }): Promise<{ current: number | null; groups: PriceGroup[] }>` — `current` is `buyPriceFor(path, terms, sells, pkg, 'renewal')` for an account scope, `null` for `all`.
  - `type LineTarget = { to: number | 'current' }`
  - `private async repriceLines(tx: Prisma.TransactionClient, lines: { id: string; posId: string; terms: Prisma.JsonValue; package: PackagePriceRow & { id: string } }[], planFor: (line) => LineTarget | null, accounts: Account[]): Promise<number>` — for each line with a target: `'current'` → `fresh = await this.stampFor(captureTerms(packageTermsOf(pkg), targets), line.posId, this.pathOf(line.posId, accounts), tx)` where `targets` come from one `packageRenewal.findMany({ where: { packageId: { in } }, include: { target: { include: { company: true, provider: true } } } })` loaded before the loop, then `repriceLine(terms, { to: 'current', fresh })`; numeric → floor check `to >= floorFor(path, termsRows, sells, pkg, 'renewal')` (rows loaded once for every package id and path id in the batch) else `fail(400, 'PRICE_BELOW_FLOOR')`, then `repriceLine(terms, { to })`; write `tx.line.update({ where: { id }, data: { terms } })`; returns the count written. Wraps the pure `RepricePlan` so callers never build `fresh` themselves.

- [ ] **Step 1: Write the failing tests**:

```ts
it('GET line-prices groups the renewable numbers in scope and tells the current price', async () => {
  const { service, gates, lines, line } = await tree();
  const at = (id: string, posPrice: number, status = 'active') => ({ ...line, id, msisdn: `05210000${id}`, status, terms: { ...(line.terms as LineTerms), renewal: { ...(line.terms as LineTerms).renewal, posPrice } } });
  lines.push(at('ln2', 4500), at('ln3', 4500), at('ln4', 4100, 'frozen'), at('ln5', 9900, 'disconnected'));
  await expect(service.linePrices(gates.ag1, 'alloha-150', { scope: 'pos1' })).resolves.toEqual({
    current: 3200,
    groups: [{ price: 3200, count: 1 }, { price: 4100, count: 1 }, { price: 4500, count: 2 }],
  });
  await expect(service.linePrices(gates.branch, 'alloha-150', { scope: 'all' })).resolves.toMatchObject({ current: null });
  await expect(service.linePrices(gates.ma1, 'alloha-150', { scope: 'all' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.linePrices(gates.ag2, 'alloha-150', { scope: 'pos1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.linePrices(gates.pos1, 'alloha-150', { scope: 'pos1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
```

- [ ] **Step 2: Run** — FAIL (`linePrices` is not a function).
- [ ] **Step 3: Implement** `lineScope`, `scopeLineWhere`, `linePrices`, `repriceLines` (the wrapper is exercised in Task 5; write it now so the shape is fixed). Controller: `@Get('packages/:code/line-prices') linePrices(@Query('scope') scope)` → `this.office.linePrices(gateOf(req), code, { scope })`, no audit action.
- [ ] **Step 4: Run** `npm test -- --runInBand user-terms-service` — PASS.
- [ ] **Step 5: Commit** `feat(api): line prices grouped by what numbers carry`

### Task 5: `PUT line-prices` — the three office cases

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts`, `office.controller.ts`, `office.dto.ts`
- Modify: `apps/api/src/modules/office/activity-log.ts:36-40` (`'package_reprice'`)
- Test: `apps/api/src/modules/office/user-terms-service.spec.ts`

**Interfaces:**
- Consumes: Task 4 helpers, `groupChanges` (Task 1).
- Produces: `async setLinePrices(gate: Gate, code: string, body: { scope?: unknown; groups?: unknown }): Promise<{ ok: true; lines: number }>` — `groupChanges(body.groups)` null → `INVALID`; loads lines with `scopeLineWhere` including `package`; `planFor(line)` finds the change whose `from === terms.renewal.posPrice`; runs `repriceLines` inside `this.runTx`. Controller: `@Put('packages/:code/line-prices')`, body DTO `LinePricesBodyDto { scope?: string; groups?: { from: number; to: number | 'current' }[] }`, audit `{ action: 'package_reprice', subjectKind: 'package', subjectRef: code }`.

- [ ] **Step 1: Write the failing tests** (fixture from Task 4's `at` helper, extracted to the file top):

```ts
it('case 1: every group to the current price', async () => {
  // pos1 custom renewal 3100; lines at 4500×2 and 4100
  const result = await service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: [{ from: 4500, to: 'current' }, { from: 4100, to: 'current' }, { from: 3200, to: 'current' }] });
  expect(result).toEqual({ ok: true, lines: 4 });
  expect(lines.filter((l) => l.status !== 'disconnected').map((l) => (l.terms as LineTerms).renewal.posPrice)).toEqual([3100, 3100, 3100, 3100]);
  expect((lines[4].terms as LineTerms).renewal.posPrice).toBe(9900);
});
it('case 2: old numbers to 41 while the custom activation price stays 35', async () => {
  userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: 3500, renewalPrice: null });
  await service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: [{ from: 4500, to: 4100 }] });
  expect(lines.filter((l) => (l.terms as LineTerms).renewal.posPrice === 4100)).toHaveLength(3);
  expect(userPackages[0]).toMatchObject({ price: 3500, renewalPrice: null });
});
it('case 3: two groups, two prices, one call', async () => {
  await service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: [{ from: 4500, to: 3900 }, { from: 4100, to: 3700 }] });
  expect(groupLinePrices(lines.filter((l) => l.status !== 'disconnected').map((l) => ({ terms: l.terms as LineTerms })))).toEqual([{ price: 3200, count: 1 }, { price: 3700, count: 1 }, { price: 3900, count: 2 }]);
});
it('a price below one number floor refuses the whole save and changes nothing', async () => {
  // agent pays renewal 2700 → pos floor 2700
  await expect(service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: [{ from: 4500, to: 2600 }, { from: 4100, to: 3000 }] })).rejects.toMatchObject({ code: 'PRICE_BELOW_FLOOR' });
  expect((lines[3].terms as LineTerms).renewal.posPrice).toBe(4100);
});
it('the nearer custom price wins when an agent runs current over its subtree', async () => {
  sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3700, renewalPrice: 3400 });
  userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: null, renewalPrice: 3000 });
  await service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'ag1', groups: [{ from: 4500, to: 'current' }] });
  expect((lines[1].terms as LineTerms).renewal.posPrice).toBe(3000);
});
it('after case 1 the next extend debits the new price', async () => {
  // reuse case 1 setup, then:
  line.endsAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
  await service.extend(gates.pos1, 'ln1', { outcome: 'success' });
  expect(entries[0]).toMatchObject({ kind: 'extend', amount: -3100 });
});
it('bad bodies are INVALID', async () => {
  await expect(service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: 'x' })).rejects.toMatchObject({ code: 'INVALID' });
});
```

The `$transaction` mock must also snapshot and restore `lines` (`terms` per row) on throw, like it does for `userPackages`; add `packageRenewal: { findMany: async () => [] }` to the client.

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `setLinePrices`, the route, DTO, and the activity action.
- [ ] **Step 4: Run** `npm test -- --runInBand` + `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(api): PUT line-prices reprices existing numbers by group`

### Task 6: `lines` count on user package rows

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` — `UserPackageRow` type (~L115-125), `userPackageRow` (~L2411), `userPackages` (the GET), `setUserPackage`, `setUserPackagesBulk`
- Modify: `apps/web/lib/api.ts:309-324` (`lines: number` on `UserPackageRow`)
- Test: `apps/api/src/modules/office/user-terms-service.spec.ts` (the test at L357 "lists the user packages grouped by company")

**Interfaces:**
- Produces: `UserPackageRow.lines: number` — renewable numbers of that package whose `posId` is in `visibleAccountIds(target.id, target.layer, accounts)`. Loaded once per request with `this.prisma.line.groupBy({ by: ['packageId'], where: { status: { in: RENEWABLE_STATUSES }, posId: { in } }, _count: { _all: true } })`; `userPackageRow` takes a `lines: Map<string, number>` argument (default empty map) and writes `lines.get(pkg.id) ?? 0`.

- [ ] **Step 1: Extend the test** at L357: add two renewable lines on `pa` and one disconnected; assert the `alloha-150` row has `lines: 3` (the fixture's `ln1` + two) and `alloha-400` has `lines: 0`. Add `line.groupBy` to the mock (group `lines` by `packageId` after `whereMatch`).
- [ ] **Step 2: Run** — FAIL (`lines` undefined).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- --runInBand user-terms-service` and `npm run typecheck` in both apps — PASS.
- [ ] **Step 5: Commit** `feat(api): user package rows count their renewable numbers`

### Task 7: Web — copy, API layer, `LinePricesDialog`, three mounts

**Files:**
- Create: `apps/web/components/line-prices-dialog.tsx`
- Modify: `apps/web/lib/api.ts` (remove `repriceRenewal`; add `linePrices`, `setLinePrices`)
- Modify: `apps/web/lib/copy/ar.ts`, `en.ts`, `he.ts` (remove `repriceTitle`? **keep** — it is still the block title; remove `repriceWhich`, `repriceStay`; add keys below)
- Modify: `apps/web/components/row-menu.tsx:7,17-30` (`'receipt'` icon)
- Modify: `apps/web/app/users/[login]/packages-terms.tsx` (`TermsRow` → `RowMenu` in `.terms-state`)
- Modify: `apps/web/app/providers/[code]/[packageCode]/page.tsx` (custom-prices `RowMenu` item; the reprice block ~L489-515; state L63-64, L141, L180-192)
- Modify: `apps/web/components/names.ts` (`package_reprice`), `apps/web/app/audit/page.tsx:20`
- Modify: `apps/web/tests/companies-shelf.spec.ts:121,132` (route `PUT /packages/lian-wecom-500/line-prices`, `GET` same)
- Create: `apps/web/tests/line-prices.spec.ts`

**Interfaces:**
- `api.linePrices(code: string, scope: string) => request<{ current: number | null; groups: { price: number; count: number }[] }>('GET', `/office/packages/${segment(code)}/line-prices?scope=${encodeURIComponent(scope)}`)`
- `api.setLinePrices(code: string, scope: string, groups: { from: number; to: number | 'current' }[]) => request<{ ok: true; lines: number }>('PUT', ...)`
- `export function LinePricesDialog({ open, code, packageName, scope, onClose, onSaved }: { open: boolean; code: string; packageName: string; scope: string; onClose: () => void; onSaved: (lines: number) => void })` — loads on open with `useLoad(() => api.linePrices(code, scope), [code, scope, open], { enabled: open })`; `Dialog size="form" title={t.linePricesTitle.replace('{name}', packageName)}`; above the table a secondary `Button` `t.linePricesFollow.replace('{price}', formatShekel(current))` when `current !== null`, else `t.linePricesFollowChain` — it sets every row's draft to `'current'`; the table is `<table className="data">` with headers `t.linePricesCurrent` (`num`), `t.linePricesCount` (`num`), `t.linePricesNew` (`num`); each new-price cell is `PriceField` with `label={`${formatShekel(price)} ${t.linePricesNew}`}`, `value` from draft (a number) or `null`, `placeholder` = `current ?? price`, `onSave={(text) => setDraft(price, text)}`; a row whose draft is `'current'` shows the hint `t.linePricesFollowShort` beside the field; `.empty` with `t.linePricesEmpty` when `groups.length === 0`; footer cancel / `t.save` disabled while no draft differs; save calls `api.setLinePrices(code, scope, changes)` where `changes` are drafts parsed with `parseShekel` (bad text → `setError(apiText('بيانات غير صالحة'))`) and `'current'` passed through, then `onSaved(data.lines)` and `onClose()`.
- Copy keys (ar / en / he):
  - `linePricesTitle`: «أسعار الأرقام القائمة — {name}» / "Existing numbers — {name}" / «מספרים קיימים — {name}»
  - `linePricesMenu`: «أسعار الأرقام القائمة» / "Existing number prices" / «מחירי מספרים קיימים»
  - `linePricesCurrent`: «السعر الحالي» / "Current price" / «מחיר נוכחי»
  - `linePricesCount`: «عدد الأرقام» / "Numbers" / «מספרים»
  - `linePricesNew`: «السعر الجديد» / "New price" / «מחיר חדש»
  - `linePricesFollow`: «اتباع السعر الحالي ({price})» / "Follow the current price ({price})" / «לפי המחיר הנוכחי ({price})»
  - `linePricesFollowChain`: «اتباع تسعيرة السلسلة» / "Follow each chain's price" / «לפי מחיר השרשרת»
  - `linePricesFollowShort`: «الحالي» / "current" / «נוכחי»
  - `linePricesScope`: «النطاق» / "Scope" / «היקף»
  - `linePricesAll`: «كل النظام» / "Whole system" / «כל המערכת»
  - `linePricesOpen`: «عرض الأرقام» / "Show numbers" / «הצג מספרים»
  - `linePricesEmpty`: «لا أرقام قابلة للتجديد على هذه الرزمة» / "No renewable numbers on this package" / «אין מספרים לחידוש בחבילה זו»
  - `linePricesSaved`: «تم تحديث {n} رقماً» / "{n} numbers updated" / «עודכנו {n} מספרים»
  - `actPackageReprice`: «إعادة تسعير أرقام» / "Reprice numbers" / «תמחור מספרים מחדש»

- [ ] **Step 1: Write the failing Playwright test** `tests/line-prices.spec.ts`:

```ts
test('the user page groups existing numbers and saves two new prices', async ({ page }) => {
  const calls = await serveOffice(page, 'agent', {
    'GET /users/pos': () => ({ body: { ...account fields as user-terms.spec uses... } }),
    'GET /users/pos/packages': () => ({ body: { summary: { total: 1, visible: 1, custom: 0 }, companies: [{ code: 'wecom', name: 'ويكوم', packages: [{ code: 'lian-wecom-150', name: '150 جيجا', dataGb: 150, months: 1, companyCode: 'wecom', hidden: false, hiddenAbove: null, parentBuy: 3000, parentRenewalBuy: 2700, price: null, renewalPrice: null, effective: 3500, renewalEffective: 3200, source: 'layer', lines: 150 }] }] } }),
    'GET /packages/lian-wecom-150/line-prices': () => ({ body: { current: 3500, groups: [{ price: 3500, count: 20 }, { price: 4100, count: 30 }, { price: 4500, count: 100 }] } }),
    'PUT /packages/lian-wecom-150/line-prices': () => ({ body: { ok: true, lines: 50 } }),
  });
  await page.goto('http://agent.localhost:3910/users/pos');
  await page.getByRole('tab', { name: 'الرزم والأسعار' }).click();
  await page.getByRole('button', { name: 'إجراءات 150 جيجا' }).click();
  await page.getByRole('menuitem', { name: 'أسعار الأرقام القائمة' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('table.data tbody tr')).toHaveCount(3);
  await expect(dialog.locator('tbody tr').nth(2).locator('td').nth(1)).toHaveText('100');
  const put = page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith('/line-prices'));
  await dialog.locator('tbody tr').nth(1).getByRole('textbox').fill('39');
  await dialog.locator('tbody tr').nth(1).getByRole('textbox').press('Enter');
  await dialog.locator('tbody tr').nth(0).getByRole('textbox').fill('37');
  await dialog.locator('tbody tr').nth(0).getByRole('textbox').press('Enter');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  expect((await put).postDataJSON()).toEqual({ scope: 'pos', groups: [{ from: 3500, to: 3700 }, { from: 4100, to: 3900 }] });
  await expect(page.getByText('تم تحديث 50 رقماً')).toBeVisible();
});
test('follow the current price fills every row', async ({ page }) => { /* same routes; click «اتباع السعر الحالي (35.00 ₪)»; PUT body groups all `to: 'current'` */ });
test('the package sheet opens the table for the whole system', async ({ page }) => {
  // as branch, routes for the sheet as companies-shelf.spec.ts builds them, plus GET line-prices?scope=all → { current: null, groups: [...] }
  // select «كل النظام», click «عرض الأرقام», expect the fill button text «اتباع تسعيرة السلسلة», and `calls` to contain 'GET /packages/lian-wecom-500/line-prices?scope=all'
});
```

The tab name and `GET /users/:login` body shape: copy them from `tests/user-terms.spec.ts`, which already opens that tab as an agent.

- [ ] **Step 2: Run** `env -u PLAYWRIGHT_BROWSERS_PATH npx playwright test tests/line-prices.spec.ts --reporter=line --output /tmp/pw-line-prices` — FAIL (menu item missing).
- [ ] **Step 3: Implement**:
  - `TermsRow`: replace the `link-btn` reset with a `RowMenu label={`${t.rowActions} ${row.name}`}` whose items are `[{ label: t.resetDefault, icon: 'undo', onClick: onReset }]` when `row.source === 'custom' && canEdit && !locked`, plus `{ label: t.linePricesMenu, icon: 'receipt', onClick: onLinePrices }` when `canEdit && row.lines > 0`; render the menu only when it has items. `UserPackagesTab` holds `const [pricing, setPricing] = useState<UserPackageRow | null>(null)` and mounts `<LinePricesDialog open={pricing !== null} code={pricing?.code ?? ''} packageName={pricing?.name ?? ''} scope={login} onClose={() => setPricing(null)} onSaved={(n) => { setNote(t.linePricesSaved.replace('{n}', String(n))); void sheet.reload(); }} />`.
  - Package sheet: the custom-prices `RowMenu` gains `{ label: t.linePricesMenu, icon: 'receipt', onClick: () => setPricing({ scope: offer.loginName }) }`. The block titled `t.repriceTitle` becomes: `Select` `t.linePricesScope` with `<option value="all">{t.linePricesAll}</option>` + one option per `users` row (`accountLabel`), and `Button variant="secondary"` `t.linePricesOpen` → `setPricing({ scope })`. Remove `repriceWhich`, `repricePrice`, `saveReprice`, and the L141 effect line. Mount one `LinePricesDialog` with `code={sheet.code}`, `packageName={sheet.name}`.
  - `companies-shelf.spec.ts`: swap the two `reprice-renewal` references for `line-prices` and adjust the interaction to scope select + «عرض الأرقام» (the test's intent, "the branch can reach the tool", stays).
- [ ] **Step 4: Run** the new spec, `tests/companies-shelf.spec.ts`, `tests/user-terms.spec.ts`, `tests/packages-terms.spec.ts`; `npm run check:copy`; `npm run typecheck` — PASS. Open `/users/<pos>` as an agent in the browser at 1440 and ~900 wide, Arabic and English, light and dark; the dialog's table must fill the dialog width and the numeric columns must be tabular.
- [ ] **Step 5: Commit** `feat(web): existing-number prices dialog on user page and package sheet`

## Part B — Transfers by layer

### Task 8: `transferAgents`, `transfer` op key, `me.stops`, pure `transfer-rules.ts`

**Files:**
- Modify: `apps/api/src/modules/office/office-grants.ts:1-26` (`'transferAgents'` in `GRANT_CODES`; `LAYER_GRANTS.branch` already spreads all)
- Modify: `apps/api/src/modules/office/user-terms.ts:8` (`'transfer'` appended to `OP_KEYS`)
- Modify: `apps/api/src/modules/office/office.service.ts` — `me` (~L243-256) adds `stops`
- Create: `apps/api/src/modules/office/transfer-rules.ts`, `transfer-rules.spec.ts`
- Modify: `apps/api/src/modules/office/office-grants.spec.ts`, `user-terms.spec.ts:120-122`, `user-terms-service.spec.ts` (a `me` test)
- Modify: `apps/web/lib/grants.ts`, `apps/web/lib/ops.ts`, `apps/web/lib/api.ts` (`Me.stops: string[]`), copy files

**Interfaces:**
- `me()` returns `stops: parseOps(serializeOps([...deniedOpsFor(this.pathOf(actor.id, accounts))]))` — the `OpKey[]` stopped on the actor's own path (own node included).
- `transfer-rules.ts`:
  - `export type TransferKind = 'line' | 'pos' | 'agent';`
  - `export function transferKind(layer: string): Exclude<TransferKind, 'line'> | null` — `'pos'` → `'pos'`, `'agent'` → `'agent'`, else `null`.
  - `export const TRANSFER_GRANT: Record<TransferKind, GrantCode> = { line: 'transferLines', pos: 'transferPos', agent: 'transferAgents' };`
  - `export const DESTINATION_LAYER: Record<TransferKind, string> = { line: 'pos', pos: 'agent', agent: 'main_agent' };`
  - `export function canTransfer(input: { kind: TransferKind; actor: { grants: readonly string[]; impersonating: boolean }; actorStops: ReadonlySet<OpKey>; currentParentId: string; destination: { id: string; layer: string; frozen: boolean } | null; visible: ReadonlySet<string> }): null | 'FORBIDDEN' | 'INVALID'` — order: impersonating or no grant → `FORBIDDEN`; `actorStops.has('transfer')` → `FORBIDDEN`; destination null, wrong layer, frozen, or `destination.id === currentParentId` → `INVALID`; `!visible.has(currentParentId) || !visible.has(destination.id)` → `FORBIDDEN`.
  - `export function parseChoice(value: unknown): 'keep' | 'reset' | null` and `parseLineChoice(value: unknown): 'keep' | 'recapture' | null`.
- Web `OP_KEYS` gains `'transfer'`; `opLabel` → `t.transfer`, `opDescription` → `t.opDescTransfer` («نقل الأرقام والحسابات من هذا الحساب» / "Moving numbers and accounts out of this account" / «העברת מספרים וחשבונות מחשבון זה»). `GRANT_CODES` gains `'transferAgents'`.

- [ ] **Step 1: Write the failing tests** — `transfer-rules.spec.ts` covering the matrix: agent with `transferLines` moving a line between its own points of sale → `null`; destination outside `visible` → `FORBIDDEN`; grant missing → `FORBIDDEN`; impersonating → `FORBIDDEN`; stop present → `FORBIDDEN`; destination frozen → `INVALID`; destination same as current parent → `INVALID`; `transferKind('main_agent')` → `null`; `parseChoice('keep')` → `'keep'`, `parseChoice('x')` → `null`. `user-terms.spec.ts`: `parseOps('transfer,charge')` → `['charge', 'transfer']`. `user-terms-service.spec.ts`: with `ma1.deniedOps = 'transfer'`, `service.me(gates.ag1)` resolves `stops: ['transfer']` and `service.me(gates.branch)` resolves `stops: []`.
- [ ] **Step 2: Run** `npm test -- --runInBand transfer-rules user-terms office-grants` — FAIL.
- [ ] **Step 3: Implement** the API side and the web constants/copy (`grantTransferAgents`: «نقل الوكلاء» / "Transfer agents" / «העברת סוכנים»; the six per-layer labels go in Task 12).
- [ ] **Step 4: Run** the three API specs, `npm run typecheck` (both apps), `npm run check:copy` — PASS. `tests/user-terms.spec.ts` now expects 9 cards and will fail; change L71 to `toHaveCount(10)` here.
- [ ] **Step 5: Commit** `feat: transferAgents grant, transfer op stop, transfer-rules module`

### Task 9: Transfer preview

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` (new method near `transferPos`), `office.controller.ts` (`@Get('users/:loginName/transfer-preview')`)
- Modify: `apps/api/src/modules/office/transfer-rules.ts` (`previewOf`)
- Create: `apps/api/src/modules/office/transfer-service.spec.ts` (uses `tree()` from `user-terms-service.spec.ts`; add a second main agent `ma2` and a pos `pos2` under `ag2` to the fixture, plus `wallet.findMany`, `user.updateMany`, `userPackage.findMany` already there)
- Test: `transfer-rules.spec.ts`

**Interfaces:**
- `previewOf(input: { moved: PathNode[] /* moved account path today */; nextPath: PathNode[] /* moved account under the new parent */; children: PathNode[][] /* each pos under an agent, new path */; terms: (TermRow & { packageId: string })[]; sells: (SellRow & { packageId: string })[]; packages: ({ id: string } & LayerPrices)[] }): { own: { customPrices: number; hidden: number; stops: number; belowNewFloor: number }; child: { customPrices: number; hidden: number; stops: number; sellPrices: number } | null }` — `own.customPrices` counts the moved account's rows with a price; `hidden` its hidden rows; `stops` `parseOps(moved[0].deniedOps).length`; `belowNewFloor` the moved account's rows whose `price < floorFor(nextPath, termsOf(pkg), sellsOf(pkg), pkg, 'subscription')` or `renewalPrice < floorFor(..., 'renewal')`; `child` is `null` when `children` is empty, else sums over the children plus `sellPrices` = the moved agent's own `SellRow` count.
- `async transferPreview(gate: Gate, loginName: string, query: { parentLogin?: unknown }): Promise<{ balance: number; subtreeBalance: number; own; child; lines: number }>` — runs `canTransfer` first (same errors as the move); `balance` = moved wallet; `subtreeBalance` = sum of wallets of the agent's points of sale (0 for a pos); `lines` = `line.count({ where: { posId: { in: subtreeIds }, status: { in: RENEWABLE_STATUSES } } })`.

- [ ] **Step 1: Write the failing tests**: `transfer-rules.spec.ts` — `previewOf` with one custom row at 2900 under a new parent whose floor is 3000 → `belowNewFloor: 1`; a pos moving (no children) → `child: null`. `transfer-service.spec.ts` — branch previews `ag1` → `ma2`: `child.customPrices`, `child.sellPrices`, `subtreeBalance` equal the fixture; `ma1` previews `ag1` → `ma2` → `FORBIDDEN` (ma2 not visible); `ag1` previews `pos1` → `ag2` → `FORBIDDEN` (no `transferPos`); preview of a pos to its current agent → `INVALID`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** The controller route takes `@Query('parentLogin')`, no audit action.
- [ ] **Step 4: Run** `npm test -- --runInBand transfer` — PASS.
- [ ] **Step 5: Commit** `feat(api): transfer preview`

### Task 10: `POST users/:login/transfer` for points of sale and agents

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` — replace `transferPos` (~L1998-2017) with `transferAccount`
- Modify: `apps/api/src/modules/office/office.controller.ts:898-910`, `office.dto.ts:225-228` (`TransferAccountBodyDto { parentLogin?: string; ownPrices?: string; ownStops?: string; childPrices?: string; childStops?: string; linePrices?: string }`)
- Modify: `apps/api/src/modules/office/notice-kinds.ts` (`TransferNoticePayload = { kind: TransferKind; subject: string; fromLogin?: string; toLogin?: string; actorName: string }`, kinds `'transfer.out' | 'transfer.in'`, group `wallet`, `hrefFor` → `/users`)
- Modify: `apps/api/src/modules/office/activity-log.ts` (`'user_transfer'`)
- Modify: `apps/api/src/modules/office/office-errors.ts` or wherever `ZERO_WALLET_FIRST` is declared (remove), and `apps/web/lib/copy/*.ts:542` (remove the key)
- Test: `transfer-service.spec.ts`; `user-terms-service.spec.ts:271-279` (update the body)

**Interfaces:**
- `async transferAccount(gate: Gate, loginName: string, body: TransferAccountBody): Promise<{ ok: true; lines: number }>` — parse choices (`parseChoice`/`parseLineChoice`; a missing required one → `INVALID`; `childPrices`/`childStops` given for a pos → `INVALID`); `canTransfer` with `kind = transferKind(target.layer)`; then one `runTx`:
  1. pos only: `line.updateMany({ where: { posId, originAgentId: null }, data: { originAgentId: target.parentId } })` (as today).
  2. `user.update({ where: { id: target.id }, data: { parentId: next.id } })`.
  3. `ownPrices === 'reset'` → `userPackage.deleteMany({ where: { userId: target.id } })`; `ownStops === 'reset'` → `user.update({ data: { deniedOps: '' } })`.
  4. agent: `childPrices === 'reset'` → `userPackage.deleteMany({ where: { userId: { in: posIds } } })` and `sellPrice.deleteMany({ where: { ownerId: target.id } })`; `childStops === 'reset'` → `user.updateMany({ where: { id: { in: posIds } }, data: { deniedOps: '' } })`.
  5. `linePrices === 'recapture'` → load renewable lines under the subtree with `package`, build `accounts` **with the parent change applied** (map the loaded array, replacing the target's `parentId`), and `repriceLines(tx, lines, () => ({ to: 'current' }), accountsAfter)`; the count is the response's `lines`.
  6. Two notices via `this.notice.write(tx, [oldParentId], actor, { kind: 'transfer.out', payload })` and `[next.id]` with `'transfer.in'`, queued with `this.queueNotices`.
  Controller: route body type `TransferAccountBodyDto`, audit `{ action: 'user_transfer', subjectKind: 'user', subjectRef: loginName }`.

- [ ] **Step 1: Write the failing tests** in `transfer-service.spec.ts`:

```ts
it('moves a point of sale with its balance and keeps or resets its own terms as asked', ...)   // wallet 100000 stays; ownPrices reset deletes pos1 rows; ownStops keep leaves deniedOps
it('moves an agent: child rows, its sell prices, and stops follow the four choices', ...)      // every keep/reset pair; ag1 SellPrice rows gone only on childPrices reset
it('recapture prices moved numbers under the new parent', ...)                                   // ag2 has SellPrice renewal 3400 → ln1 renewal.posPrice becomes 3400; with keep it stays 3200 and terms are toEqual before/after
it('writes transfer.out to the old parent and transfer.in to the new one', ...)                  // spy on notice.write
it('refuses what the rules refuse and a missing choice is INVALID', ...)                          // FORBIDDEN for ag1 moving pos1 to ag2 without transferPos; INVALID for body without linePrices
it('no zero-wallet rule remains', ...)                                                            // pos1 wallet 5000, branch moves it → ok
```

Update `user-terms-service.spec.ts:271` ("moving a point of sale drops the terms") to call `transferAccount(gates.branch, 'pos1', { parentLogin: 'ag2', ownPrices: 'reset', ownStops: 'keep', linePrices: 'keep' })` and drop `wallet.balance = 0`.

- [ ] **Step 2: Run** `npm test -- --runInBand transfer user-terms-service` — FAIL.
- [ ] **Step 3: Implement.** Remove `ZERO_WALLET_FIRST` everywhere (`rg ZERO_WALLET_FIRST apps` must be empty).
- [ ] **Step 4: Run** `npm test -- --runInBand`, `npm run typecheck`, `npm run check:copy` — PASS.
- [ ] **Step 5: Commit** `feat(api): transfer points of sale and agents with explicit choices and notices`

### Task 11: Line transfer gains the rules and `linePrices`

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` — `transferLine` (~L2019-2037)
- Modify: `apps/api/src/modules/office/office.dto.ts:139-142` (`linePrices?: string`)
- Test: `transfer-service.spec.ts`

**Interfaces:**
- `async transferLine(gate, lineId, body: { posLogin?: unknown; linePrices?: unknown })` — `canTransfer({ kind: 'line', currentParentId: line.posId, destination: next pos, ... })`; after the pos change, `linePrices === 'recapture'` → `repriceLines(tx, [{ ...line, posId: next.id }], () => ({ to: 'current' }), accounts)`; notices `transfer.out` to the old pos and `transfer.in` to the new pos with `subject = msisdn`; `recordOp` as today.

- [ ] **Step 1: Write the failing tests**: agent moves `ln1` from `pos1` to `pos2` (under ag2) → `FORBIDDEN` for `ag1`, ok for `ma1`; with `recapture` the line takes pos2's resolved renewal price; with `transfer` stopped on `ma1`, `ma1` is refused and the branch is not; destination frozen → `INVALID`; missing `linePrices` → `INVALID`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- --runInBand` — PASS.
- [ ] **Step 5: Commit** `feat(api): line transfer follows the transfer rules and may recapture`

### Task 12: Web — API layer, copy, roles labels, notices, ops card

**Files:**
- Modify: `apps/web/lib/api.ts:208-210` (`transferAccount(loginName, body)`, `transferPreview(loginName, parentLogin)`, `transferLine(id, posLogin, linePrices)`)
- Modify: `apps/web/lib/copy/{ar,en,he}.ts` — keys below
- Modify: `apps/web/lib/grants.ts` — `grantLabel(t, code, layer?: string)`: for `transferLines` / `transferPos` / `transferAgents` pick the per-layer label; other codes unchanged
- Modify: `apps/web/app/roles/page.tsx:64-66,116-130` — pass `draft.layer || 'branch'` (job roles are branch) to `grantLabel`; hide a code the layer cannot use: `agent` hides `transferPos`, `transferAgents`; `main_agent` hides `transferAgents`; `pos` hides all three
- Modify: `apps/web/lib/notice-text.ts` — `transfer.out` → `t.noticeTransferOut`, `transfer.in` → `t.noticeTransferIn`; detail: `subject · toLogin/fromLogin · «بواسطة» actorName`
- Modify: `apps/web/components/names.ts` (`user_transfer` → `t.actUserTransfer`), `apps/web/app/audit/page.tsx:20`
- Copy keys:
  - `grantTransferLinesAgent` «نقل الأرقام داخل السلسلة» / "Transfer numbers inside the chain" / «העברת מספרים בתוך השרשרת»
  - `grantTransferLinesMain` «نقل الأرقام خارج السلسلة» / "Transfer numbers outside the chain" / «העברת מספרים מחוץ לשרשרת»
  - `grantTransferLinesBranch` «نقل الأرقام بين السلاسل» / "Transfer numbers between chains" / «העברת מספרים בין שרשראות»
  - `grantTransferPosMain` «نقل نقاط البيع داخل السلسلة» / "Transfer points of sale inside the chain" / «העברת נקודות מכירה בתוך השרשרת»
  - `grantTransferPosBranch` «نقل نقاط البيع خارج السلسلة» / "Transfer points of sale outside the chain" / «העברת נקודות מכירה מחוץ לשרשרת»
  - `grantTransferAgents` «نقل الوكلاء» (added in Task 8)
  - `transferOwnTerms` «شروط الحساب» / "Account terms" / «תנאי החשבון»; `transferChildTerms` «شروط ما تحته» / "Terms below it" / «תנאים מתחתיו»
  - `transferPricesRow` «الأسعار والإخفاء» / "Prices and hidden packages" / «מחירים והסתרות»; `transferStopsRow` «الإيقافات» / "Stops" / «עצירות»; `transferLinesRow` «أسعار الأرقام المنقولة» / "Prices of the moved numbers" / «מחירי המספרים המועברים»
  - `transferKeep` «تبقى كما هي» / "Stay as they are" / «נשארים כפי שהם»; `transferFollow` «تتبع السلسلة الجديدة» / "Follow the new chain" / «לפי השרשרת החדשה»; `transferRecapture` «تُحسب من جديد» / "Recalculated" / «מחושבים מחדש»
  - `transferBalance` «الرصيد المنقول» / "Balance moving" / «יתרה מועברת»; `transferSubtreeBalance` «رصيد ما تحته» / "Balance below it" / «יתרה מתחתיו»; `transferLinesCount` «{n} رقماً» / "{n} numbers" / «{n} מספרים»; `transferBelowFloor` «{n} سعراً خاصاً أقل من تكلفة الأب الجديد» / "{n} custom prices below the new parent's cost" / «{n} מחירים מותאמים מתחת לעלות ההורה החדש»
  - `transferDestinationAgent` «الوكيل الجديد» / "New agent" / «סוכן חדש»; `transferDestinationMain` «الوكيل الرئيسي الجديد» / "New main agent" / «סוכן ראשי חדש»
  - `noticeTransferOut` «نُقل من حسابك» / "Moved out of your account" / «הועבר מחשבונך»; `noticeTransferIn` «نُقل إلى حسابك» / "Moved into your account" / «הועבר לחשבונך»; `noticeTo` «إلى» / "to" / «אל»
  - `actUserTransfer` «نقل حساب» / "Account transfer" / «העברת חשבון»
  - Remove: `ZERO_WALLET_FIRST` (Task 10), `grantTransferLines`, `grantTransferPos` (replaced by the per-layer keys).

- [ ] **Step 1: Write the failing Playwright test** `tests/roles-transfer-labels.spec.ts`: as branch with `GET /roles` returning an agent layer role `{ kind: 'layer', layer: 'agent', grants: 'read,transferLines' }` and a job role with all three; the table's permissions cell for the agent role reads «نقل الأرقام داخل السلسلة»; the job role's reads «نقل الأرقام بين السلاسل · نقل نقاط البيع خارج السلسلة · نقل الوكلاء» (order of `GRANT_CODES`); opening the agent role's edit dialog shows no checkbox for «نقل نقاط البيع» or «نقل الوكلاء».
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new spec, `tests/packages-roles-desk.spec.ts`, `npm run check:copy`, `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(web): transfer grant labels per layer, transfer notices, API calls`

### Task 13: Web — `TransferDialog` on the users page, number detail, ops card

**Files:**
- Create: `apps/web/components/transfer-dialog.tsx`
- Modify: `apps/web/app/users/page.tsx:145-167` (row menu), `:304-375` (remove the inline `transfer` branch from the shared dialog; mount `TransferDialog`)
- Modify: `apps/web/app/numbers/[id]/page.tsx:52,176,379-410` (radio pair + `stops` check)
- Modify: `apps/web/app/users/[login]/line-ops.tsx:3,14-24` (`ArrowRightLeft` icon for `transfer`)
- Create: `apps/web/tests/transfer.spec.ts`

**Interfaces:**
- `export function TransferDialog({ open, row, destinations, onClose, onDone }: { open: boolean; row: UserRow | null; destinations: UserRow[]; onClose: () => void; onDone: () => void })` — `kind = row.layer === 'pos' ? 'pos' : 'agent'`; `Dialog size="form" mark="transfer" title={t.transfer}`; `Select` labelled `kind === 'pos' ? t.transferDestinationAgent : t.transferDestinationMain` over `destinations` (already filtered by the caller to the right layer, excluding `row.parentLogin`); on change calls `api.transferPreview(row.loginName, parentLogin)` and shows its error (`error` prop) or the preview block; two `fieldset`s `t.transferOwnTerms` (rows `transferPricesRow`, `transferStopsRow`) and, for an agent, `t.transferChildTerms` (same two rows); each row is a `label.check`-styled radio pair `t.transferKeep` / `t.transferFollow` named per row; a last fieldset `t.transferLinesRow` with `t.transferKeep` / `t.transferRecapture` and the hint `t.transferLinesCount.replace('{n}', preview.lines)`; preview block: `transferBalance` with `Money`, `transferSubtreeBalance` for an agent, and a `.badge.pending` `transferBelowFloor` when `own.belowNewFloor > 0`; footer cancel / `t.transfer` disabled until destination picked, preview loaded, and every radio chosen (no defaults); submit `api.transferAccount(row.loginName, { parentLogin, ownPrices, ownStops, childPrices?, childStops?, linePrices })` then `onDone()`.
- Users page: `canMovePos = me.grants.includes('transferPos')`, `canMoveAgent = me.grants.includes('transferAgents')`, both `&& !me.stops.includes('transfer') && !me.impersonating`; item «نقل» on a pos row when `canMovePos`, on an agent row when `canMoveAgent`; `destinations = rows.filter((r) => r.layer === (row.layer === 'pos' ? 'agent' : 'main_agent') && r.loginName !== row.parentLogin && !r.frozen)`.
- Number detail: `canTransfer = me.grants.includes('transferLines') && !me.stops.includes('transfer')`; the dialog adds the `t.transferLinesRow` radio pair, `linePrices` state `'' | 'keep' | 'recapture'`, button disabled until chosen; call `api.transferLine(line.id, posLogin, linePrices)`.

- [ ] **Step 1: Write the failing Playwright tests** `tests/transfer.spec.ts`:

```ts
test('branch moves an agent: destination, preview, five choices, request body', async ({ page }) => {
  // serveOffice(page, 'branch', { 'GET /users': users incl. ma1, ma2, ag1 (parent ma1), pos1; 'GET /me' override with grants incl. transferAgents, stops: []; 'GET /users/ag1/transfer-preview': { balance: 1200, subtreeBalance: 5000, own: { customPrices: 2, hidden: 1, stops: 0, belowNewFloor: 1 }, child: { customPrices: 3, hidden: 0, stops: 1, sellPrices: 2 }, lines: 37 }; 'POST /users/ag1/transfer': { ok: true, lines: 37 } })
  // open «إجراءات ag1» → «نقل»; select ma2; expect preview text «37 رقماً» and the below-floor badge; button «نقل» disabled; choose: own prices keep, own stops follow, child prices follow, child stops keep, lines recapture; click «نقل»
  // expect POST body toEqual({ parentLogin: 'ma2', ownPrices: 'keep', ownStops: 'reset', childPrices: 'reset', childStops: 'keep', linePrices: 'recapture' })
});
test('a main agent sees only its own agents as destinations and no «نقل» on agent rows', ...);
test('«نقل» is absent when transfer is stopped on the actor path', ...);  // me.stops: ['transfer']
test('number detail sends linePrices with the transfer', ...);              // as agent with transferLines; POST /lines/ln1/transfer body { posLogin: 'pos2', linePrices: 'keep' }
```

For the main-agent case, `serveOffice`'s `main_agent` profile has `grants: []`; override `GET /me` in the routes with `grants: ['transferLines', 'transferPos'], stops: []`.

- [ ] **Step 2: Run** `env -u PLAYWRIGHT_BROWSERS_PATH npx playwright test tests/transfer.spec.ts --reporter=line --output /tmp/pw-transfer` — FAIL.
- [ ] **Step 3: Implement.** In `line-ops.tsx` add `transfer: ArrowRightLeft` to `ICONS` (lucide). Check the dialog at 1440 and ~900 wide, Arabic and English, light and dark: the two fieldsets sit side by side on wide and stack on narrow; radios are `label.check` with 44px targets.
- [ ] **Step 4: Run** the new spec, `tests/users-desk.spec.ts`, `tests/numbers-desk.spec.ts`, `tests/detail-desk.spec.ts`, `tests/user-terms.spec.ts` (ten cards); `npm run typecheck`; `npm run check:copy` — PASS.
- [ ] **Step 5: Commit** `feat(web): transfer dialog for points of sale and agents; line transfer choice`

### Task 14: Docs, full CI run, push, watch

**Files:**
- Modify: `DESIGN.md` — Components: "Line prices dialog" and "Transfer dialog" one paragraph each (what they are, which classes they reuse)
- Modify: `docs/superpowers/plans/2026-11-07-transfers-and-line-prices.md` — status line at the top with deviations, if any
- Modify: `.superpowers/sdd/…/progress.md` if the executing method keeps a ledger

- [ ] **Step 1:** `npm run lint && npm run check:copy && npm run typecheck && npm run test:api && npm run build` from the repo root — all green. Revert any auto-edit to `apps/web/tsconfig.json`.
- [ ] **Step 2:** `cd apps/web && env -u PLAYWRIGHT_BROWSERS_PATH npx playwright test --reporter=line --output /tmp/pw-all` — all green (the known flaky `esim-ops.spec.ts` may need one rerun; report if it does).
- [ ] **Step 3:** Commit docs: `docs: line prices dialog and transfer dialog in DESIGN.md; plan status`.
- [ ] **Step 4:** `git push origin main` (smart-mode approval card), then `gh run list --limit 3` → `gh run watch <id>`; if red, fix in this slice and push again.
- [ ] **Step 5:** Report in chat: run id, conclusion of both jobs, and the list of deviations from the spec.
