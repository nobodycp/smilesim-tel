# Prepaid periods refund implementation plan

Spec: `docs/superpowers/specs/2026-11-05-prepaid-periods-refund.md`.

**Goal:** a disconnect and a package switch value every paid day that is left on the line, and a disconnect is confirmed with its amount first.

## Global constraints

- Money in agorot. Whole days. Same 0.50 ₪ fee.
- Rows written before this change keep the last-window rule.
- No commit, no deploy. The audit runs on `smilesim_audit` only.

### Task 1: Periods and the refund rule

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_wallet_entry_period/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (`WalletEntry.periodDays`, `WalletEntry.periodEndsAt`)
- Modify: `apps/api/src/modules/office/office-rules.ts` (`daysLeft`, `openPeriods`, `disconnectSettlement` and `switchDifference` over periods)
- Modify: `apps/api/src/modules/office/office-rules.spec.ts` (the stacked cases first, failing)
- Modify: `apps/api/src/modules/office/office.service.ts` (`Sale.period`, `move` and `recordOp` write it, every prepaid path sets it, `disconnectSettlementFor` and `switchQuote` read the open periods, task extend/charge record the bought package and the paid price)
- Modify: `apps/web/audit/operations.audit.ts` (the stacked disconnect expects every day back; a stacked switch case)

Done when the API tests pass and the operations audit is green, including the eSIM, extend, then disconnect case.

### Task 2: Disconnect confirmation

**Files:**
- Modify: `apps/api/src/modules/office/office.controller.ts`, `office.service.ts` (`GET /office/lines/:id/disconnect-quote`)
- Modify: `apps/api/src/modules/office/response-shape.spec.ts` (the quote shape)
- Modify: `apps/web/lib/api.ts` (`disconnectQuote`)
- Modify: `apps/web/components/line-actions.ts`, `apps/web/app/numbers/page.tsx`, `apps/web/app/numbers/[id]/page.tsx` (disconnect opens the dialog)
- Modify: `apps/web/lib/copy/{ar,en,he}.ts` (dialog copy)
- Modify: `apps/web/audit/operations.audit.ts` (disconnect goes through the dialog and checks the amount it showed)

Done when the audit confirms the dialog's amount equals the amount that moved, and the screens audit is clean.
