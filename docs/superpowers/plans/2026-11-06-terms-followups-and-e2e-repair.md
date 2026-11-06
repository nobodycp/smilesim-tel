# Terms follow-ups and e2e repair — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-11-06-terms-followups-and-e2e-repair.md`
**Status:** in progress

Verification for every task: `npm run lint`, `npm run check:copy`, `npm run typecheck`, API tests as
`cd apps/api && npm test -- --runInBand`, and the named Playwright file as
`cd apps/web && env -u PLAYWRIGHT_BROWSERS_PATH npx playwright test <file> --reporter=line`.

## Task 1 — e2e repair

Files: `apps/web/tests/desk.ts`, `apps/web/tests/lists-desk.spec.ts`, `apps/web/tests/numbers-desk.spec.ts`,
`apps/web/tests/login.spec.ts`, `apps/web/tests/tools-pages.spec.ts`.

- [ ] `expectFullTable`: `exact: true` on the h2 check; remove the `.lede` count.
- [ ] `lists-desk`: route `**/office/providers/cell/settings` → `{ code, name: 'سلكوم', modes: {}, esimPrice: null }`; list route stays for `**/office/providers`.
- [ ] `numbers-desk`: trigger regex `/إجراءات/`.
- [ ] `login`: a `DELETE /auth/sessions/*` route sets `ended = true`; `GET` answers 401 only when `ended`.
- [ ] `tools-pages`: row menus `toHaveCount(2)`; reactivate notice text «شحن · بواسطة نقطة».
- [ ] Run the full Playwright suite; expect 0 failed.

## Task 2 — DELETE sell price (API)

Files: `apps/api/src/modules/office/office.service.ts`, `office.controller.ts`, `user-terms-service.spec.ts`.

- [ ] `clearSellPrice(gate, code)`: same actor gate as `setSellPrice`; `sellPrice.deleteMany({ packageId, ownerId })`; returns `{ ok: true }`.
- [ ] Controller `@Delete('sell-prices/:code')` with audit `sell_price`.
- [ ] Test: agent sets then clears; pos and branch get `FORBIDDEN`; clearing a missing row is `ok`.

## Task 3 — Reset control on /packages (web)

Files: `apps/web/lib/api.ts`, `apps/web/app/packages/page.tsx`, `apps/web/tests/packages-terms.spec.ts`.

- [ ] `api.clearSellPrice(code)` → `DELETE /office/sell-prices/:code`.
- [ ] In the sell cell, after «حفظ», an icon button (`undo`, `aria-label` `${t.resetDefault} ${row.name}`) shown only when `row.sellPrice !== null`; on success the draft clears and the catalog reloads.
- [ ] Test: the row with a sell price shows the reset, clicking it sends the DELETE; the row without one has no reset.
- [ ] Browser: agent door, ar/en, light/dark, 1440 and narrow.

## Task 4 — Bulk write in one transaction (API)

Files: `apps/api/src/modules/office/office.service.ts`, `user-terms-service.spec.ts`.

- [ ] `setUserPackagesBulk`: one `userPackage.findMany` / `sellPrice.findMany` for the path and the requested package ids; writes inside `runTx` using a tx-scoped writer.
- [ ] Test: a bulk call where the second package fails the floor leaves the first unwritten.

## Task 5 — Accounts once per request (API)

Files: `apps/api/src/modules/office/office.service.ts`.

- [ ] `resolveBuyPrice(posId, pkg, kind, accounts?)` and `visibleFor(posId, pkg, accounts?)` take the loaded accounts; `activate`, `extend`, `switchPackage`, `visibleSwitchTargets` pass theirs.
- [ ] Existing tests stay green; no new behaviour.

## Task 6 — Close

- [ ] Full CI-equivalent run, push, watch the run, report id and conclusion.
- [ ] Mark this plan done.
