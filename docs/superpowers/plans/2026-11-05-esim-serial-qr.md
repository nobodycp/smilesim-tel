# eSIM price, eSIM request, serial and QR on lines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Price an eSIM per company with provider and package overrides, add the "eSIM request" task that ends with the employee attaching serial + QR, let a number-change task take the new number at completion, and show SIM type, serial, QR, and last recharge on the numbers list and the line card with a desktop-width details layout.

**Architecture:** Pure pricing in `office-rules.ts` (`esimPriceOf`); `office.service.ts` reads it in activation, the new `requestEsim`, and task completion, which now accepts per-action fields (`iccid`, `qr`, `msisdn`). The web gets one `esim-qr.tsx` (badge, thumbnail, dialog), one `qr-image.ts` compactor, and new fields on the company, provider, package, task, and line screens. `.detail-rows` becomes a responsive card grid.

**Tech Stack:** NestJS + Prisma 7, Next.js 16 + React 19, Jest, browser check. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-05-esim-serial-qr-design.md`

## Global Constraints

- Colours only through `--rd-*` tokens; new token `--rd-qr-tile` goes into `:root` and `.dark` in `apps/web/app/styles/tokens.css` and `DESIGN.md`.
- Copy keys in `ar.ts`, `en.ts`, `he.ts`; `npm run check:copy -w web` passes.
- Latin identifiers in `<bdi dir="ltr">`; dates through `latinWhen`; money through `Money`; prices in agorot on the wire, shekels in fields (`shekelField` / `agorotOf` helpers already used by the package sheet).
- `Dialog` is the only overlay; page-level actions stay visible; `label.check` for checkboxes.
- Logical CSS properties only. Check Arabic + English, light + dark, ~1440px and a narrow window before calling a UI task done.
- Commit after every task; messages in English.

## Review Focus

1. A historical eSIM line (`esim: true`, `iccid: null`, `esimQr: null`) renders the "eSIM بلا رمز" badge with no thumbnail — Task 6 check.
2. eSIM request on a company with `sim.esim = false` is refused before a task or debit exists — Task 3 test.
3. Rename completion with a number already used by another line is `NUMBER_TAKEN` and leaves the task `working` — Task 3 test.
4. `lastRechargeAt` ignores `sim`, `esim`, `switch`, `refresh`, `disconnect` entries newer than the last recharge — Task 2 test.
5. A QR picked in the swap dialog but the checkbox later unchecked must not be sent — Task 7 check.

---

### Task 1: Pricing function and schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`Company`, `Provider`, `Package`, `Line`, `OfficeTask`)
- Create: `apps/api/prisma/migrations/20261105100000_esim_price_and_qr/migration.sql`
- Modify: `apps/api/src/modules/office/office-rules.ts` (replace `ESIM_FEE` with `ESIM_PRICE_DEFAULT = 500` and add `esimPriceOf`)
- Test: `apps/api/src/modules/office/office-rules.spec.ts`

**Interfaces:**
- Produces: `export const ESIM_PRICE_DEFAULT = 500`; `export function esimPriceOf(parts: { pkg?: { esimPrice?: number | null } | null; provider?: { esimPrice?: number | null } | null; company?: { esimPrice?: number | null } | null }): { price: number; source: 'package' | 'provider' | 'company' }`.

- [ ] Schema: `Company.esimPrice Int @default(500)`, `Provider.esimPrice Int?`, `Package.esimPrice Int?`, `Line.esimQr String?`, `OfficeTask.esimQr String?`. Migration SQL with the five `ALTER TABLE`. `npm run prisma:generate -w api`.
- [ ] Tests: package 700 / provider 600 / company 400 → 700 `package`; null / 600 / 400 → 600 `provider`; null / null / 400 → 400 `company`; all missing → 500 `company`.
- [ ] Implement; run `npm test -w api -- office-rules.spec.ts`.
- [ ] Commit `feat(api): eSIM price per company, provider, package; Line.esimQr`.

### Task 2: Read shapes

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts` — `lines()`, `line()`, `packages()` rows, `packageSheet()`, `providerSettings()`, `companiesShelf()` sim block, `taskDetail`.
- Test: `apps/api/src/modules/office/response-shape.spec.ts`

- [ ] `lines()` rows: `esimQr`. `line()`: `esimQr`, `lastRechargeAt` (newest of the fetched `entries` with kind in `['activate','charge','extend','reactivate']`, falling back to one `findFirst` when the 40 fetched have none), `esimPrice` (effective, agorot). `operationsFor` adds `'esim'` when status active, not locked, and the company takes eSIM.
- [ ] `packages()` rows: `esimPrice` effective. `packageSheet()`: `esimPrice` own, `esimPriceEffective`, `esimPriceSource`. `providerSettings()`: `esimPrice`. Companies shelf `sim` gains `esimPrice`. Task detail: `esimQr`, `sim` rules.
- [ ] Tests: `LINE_KEYS` + `esimQr`; card `lastRechargeAt` with fixture entries `[activate 11-04, sim 11-06, switch 11-07]` → 11-04; no entries → null.
- [ ] Commit `feat(api): esimQr, lastRechargeAt, effective eSIM price on read shapes`.

### Task 3: Writes — pricing edits, eSIM request, swap flags, completion fields

**Files:**
- Modify: `office.service.ts` — `setCompanySim`, new `setProviderEsimPrice`, `setChain`, `activate` (fee), `swapSim`, new `requestEsim`, `renameLine`, `completeTask`.
- Modify: `office.controller.ts` — new `PATCH providers/:code/esim-price`, new `POST lines/:id/esim`, body DTOs.
- Modify: `office.dto.ts` — `CompanySimBodyDto.esimPrice`, `ProviderEsimPriceBodyDto`, `SwapSimBodyDto { iccid, esim?, qr?, outcome }`, `CompleteTaskBodyDto { note?, iccid?, qr?, msisdn? }`.
- Modify: `office-rules.ts` — `readSimRules` reads `esimPrice` (integer ≥ 0) into `SimRules.esimPrice`; `offeredOperations` unchanged (esim is appended by the service); add `'esim'` to `PROVIDER_OPERATION_KINDS` and the two inline kind lists.
- Modify: `errors.ts` — `QR_INVALID: 'صورة رمز QR غير صالحة'` (+ en/he in web copy).
- Test: create `apps/api/src/modules/office/esim-ops.spec.ts`; update `operation-log.spec.ts` expectations if the swap answer shape changes (it does not: still `{ applied, debited }`).

- [ ] `readQr(value: unknown): string | null | undefined` helper in the service: `undefined` when absent, `null` when `null`/empty, the data URL when it matches `^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$` and is ≤ 400 000 chars, else `fail(400, 'QR_INVALID')`.
- [ ] `requestEsim(gate, lineId)`: visible line, not locked, active, company takes eSIM else `ESIM_UNSUPPORTED`; `price = esimPriceOf({ pkg: line.package, provider: line.package.provider, company: line.package.company }).price`; `openTask({ action: 'esim', posDelta: -price, esim: true, iccid: null, msisdn: line.msisdn, note: 'مهمة فرع' })`; return `{ applied: false, taskId }`. `visibleLine` include gains `provider`.
- [ ] `swapSim`: `esim` flag and `qr`; eSIM on refusing company → `ESIM_UNSUPPORTED`; run-now update `{ iccid, esim, esimQr: esim ? qr ?? null : null }`; task path stores `esimQr` on the task.
- [ ] `activate`: `posDelta = -(unit + (esim ? esimPriceOf(...).price : 0))`.
- [ ] `renameLine`: `msisdn` optional; required when `runsNow`; `openTask` with `msisdn: msisdn || null`.
- [ ] `completeTask(gate, id, body)`: parse `note`, `iccid`, `qr`, `msisdn`. Per action: `esim` requires serial passing `simRefusal` and a QR, updates the line `{ iccid, esim: true, esimQr }`, copies serial to the task; `rename` requires a valid, untaken `msisdn`, updates line and task; `activate` with `esim` applies optional serial/QR at creation; `sim` with `esim` applies `qr ?? task.esimQr`. Debit stays the existing `task.posDelta` path (kind `esim` lands in the wallet entry).
- [ ] Tests in `esim-ops.spec.ts` (harness copied from `operation-log.spec.ts`, with `officeTask.create/findUnique/update` and `line.findUnique` by id in the fake client): price from company (400), provider (600), package (700); refusal when `company.esim=false`; completion without QR → `INVALID`; with serial + QR → line has them, wallet −700, entry kind `esim`; rename completion with taken number → `NUMBER_TAKEN`, line unchanged; swap `esim: true` → line esim, free.
- [ ] Commit `feat(api): eSIM request task, priced eSIM, swap eSIM flag, task completion fields`.

### Task 4: Web types, copy, tokens, QR compactor

**Files:**
- Modify: `apps/web/lib/api.ts` — `LineRow.esimQr`, `lastRechargeAt?`, `esimPrice?`; `SimRules.esimPrice`; `TaskDetail.esimQr`, `sim?`; `PackageSheet.esimPrice/esimPriceEffective/esimPriceSource`; `ProviderSettings.esimPrice`; `swapSim(id, { iccid, esim, qr }, outcome)`; `requestEsim(id)`; `renameLine(id, msisdn | '', outcome)`; `completeTask(id, { note, iccid?, qr?, msisdn? })`; `setProviderEsimPrice(code, price | null)`; `setChain` accepts `esimPrice`.
- Create: `apps/web/lib/qr-image.ts` — `compactQr(file: File): Promise<string>`.
- Modify: `ar.ts`, `en.ts`, `he.ts`; `tokens.css` (`--rd-qr-tile`); `DESIGN.md`.

- [ ] Implement; `npm run check:copy -w web && npx tsc --noEmit -p apps/web` (fix the `swapSim`/`completeTask` call sites to the new signatures as part of this task).
- [ ] Commit `feat(web): eSIM types, copy, QR tile token, compactQr`.

### Task 5: Price editing screens

**Files:**
- Modify: `apps/web/app/companies/[code]/page.tsx` (SIM form + eSIM price field)
- Modify: `apps/web/app/providers/[code]/page.tsx` (eSIM price field with "use company price")
- Modify: `apps/web/app/providers/[code]/[packageCode]/page.tsx` (chain gains eSIM price with "use inherited price" and the effective value + source as hint)

- [ ] Implement, browser check the three screens, commit `feat(web): eSIM price on company, provider, and package sheets`.

### Task 6: Shared eSIM pieces and numbers list

**Files:**
- Create: `apps/web/components/esim-qr.tsx` (`SimBadge`, `EsimMark`, `EsimDialog`)
- Modify: `apps/web/app/styles/desk.css` (`.esim-mark`, `.sim-cell`, `.qr-tile`), `apps/web/app/numbers/page.tsx` (SIM column, dialog, skeleton count)

- [ ] Implement; browser check with a physical row, an eSIM-with-QR row, and a pending eSIM row; commit `feat(web): SIM column with eSIM QR thumbnail on /numbers`.

### Task 7: Line card

**Files:**
- Modify: `apps/web/app/numbers/[id]/page.tsx` (head badges, eSIM request tile + confirm dialog, swap dialog eSIM check + QR picker, details rows, QR dialog)
- Modify: `apps/web/app/styles/desk.css` (`.detail-rows` grid, `.line-details`)
- Modify: `apps/web/components/desk.tsx` `actionName` (`esim`)

- [ ] Implement; browser check both line kinds at 1440px and ~900px, both languages and themes; commit `feat(web): line card SIM details, eSIM request, swap eSIM, desktop grid`.

### Task 8: Task card completion fields

**Files:**
- Modify: `apps/web/app/tasks/[id]/page.tsx` (completion row fields per action, QR preview, serial hint from `task.sim`)
- Modify: `apps/web/app/styles/desk.css` or the tasks stylesheet owner (`.task-close-row` wraps its fields)

- [ ] Implement; browser check an `esim` task, a `rename` task, and a plain task; commit `feat(web): task completion takes serial + QR for eSIM, new number for rename`.

### Task 9: Verification

- [ ] `npm test -w api && npm run check:copy -w web && npm run lint -w web && npx tsc --noEmit -p apps/web`.
- [ ] `npx prisma migrate deploy` in `apps/api` against the dev database.
- [ ] Final screenshots: `/numbers`, `/numbers/:id` details, QR dialog, `/tasks/:id` eSIM completion, package sheet eSIM price.
