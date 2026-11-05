# Package switch difference implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A package switch debits or credits the point-of-sale wallet by the remaining-day price difference, and leaves `endsAt` unchanged.

**Architecture:** `switchDifference` in `office-rules.ts` is the pure settlement. `switchOnto` only validates the target and builds the new terms, keeping the open window length in `windowMonths`. `OfficeService` resolves the two point-of-sale prices and posts the signed difference at apply time, including when a manual task is marked done.

**Tech Stack:** NestJS, Prisma, Jest.

## Global Constraints

- Money is agorot. A month is 30 days. Day shares round to the nearest agorot.
- Remaining days use the disconnect day count on the open window (`windowMonths`, else `months`).
- A positive difference debits the point of sale. A negative difference credits it.
- The wallet row's package price is the new full point-of-sale buy price.
- `endsAt` does not change. The next charge, extend, or reactivate replaces the window.
- Do not rewrite an already posted switch. Do not change provider cost, activate, charge prices, extend prices, or the disconnect fee.

---

### Task 1: Settlement rule

**Files:**
- Modify: `apps/api/src/modules/office/office-rules.ts`
- Test: `apps/api/src/modules/office/office-rules.spec.ts`

- [x] Add failing tests for the 183, −167, and −56 agorot examples, a closed window, and `switchOnto` keeping `windowMonths`.
- [x] Add `remainingDays`, `switchDifference`, and `windowMonthsOf`. `switchOnto` returns terms only. `renewStay` and `renewOnto` set `windowMonths` to the new window.

### Task 2: Post the difference

**Files:**
- Modify: `apps/api/src/modules/office/office.service.ts`

- [x] Quote the difference from the last prepaid package price and `buyPrice` of the target renewal.
- [x] Direct switch and task completion post that quote, keep `endsAt`, and store the full new price on the row.
- [x] Opening a task stores the preview only. Completion recomputes.
- [x] Charge, reactivate, and renewal set `windowMonths` to the window they open.

### Task 3: Verify

- [x] Run `npm test -- --testPathPattern=office-rules` in `apps/api`.
- [x] Run `npx tsc -p tsconfig.json --noEmit` in `apps/api`.
