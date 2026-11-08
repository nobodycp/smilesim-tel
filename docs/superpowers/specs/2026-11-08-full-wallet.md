# The full wallet (roadmap N6)

Date: 2026-11-08 · Status: done · Owner rules: `docs/project-plan.md` → 2026-11-08 («المحفظة كاملة»)

Rules (owner): every movement is on the wallet of each layer, with its operation and its reason. Deposit and deduct.
No transfers between accounts: only the parent funds its child, and the parent takes money back with a note. A hold is
automatic when a task opens. A deduction comes from consumption (operations), a correction, or a settlement. The
spending limit is the existing ceiling (how far below zero the account may go).

## Design

- **Reason on every manual movement.** `WalletEntry.reason`: `deposit` | `correction` | `settlement` for a fund;
  `return` | `correction` | `settlement` for a deduction. The ledger shows it beside the operation, with the note.
- **Deposit** stays `POST /office/wallets/:login/fund`, now with `reason` (default `deposit`).
- **Deduct / take back**: `POST /office/wallets/:login/deduct` `{ amount, reason, note }` — the same accounts that may fund
  it (the branch any account below, everyone else a direct child). The child's wallet goes down (`deduct`), the
  parent's goes up by the same amount (`deduct_in`); the note is required; the child stays within its ceiling.
- **Automatic hold.** `Wallet.held`; opening a task that will charge (`posDelta < 0`) holds that amount
  (`OfficeTask.held`, entry `hold`, `held` on the entry, amount 0) and is refused when the available money
  (balance − held + ceiling) does not cover it. Completing the task releases the hold and charges; cancelling or
  rejecting it releases the hold (entry `release`). Every debit now checks the available money, not the balance alone.
- **Available** everywhere = balance + ceiling − held: the users list, the user page, the finance cards, the balances
  report. A «محجوز» card shows what is held.

## Behaviour that changes

- A task whose price the point of sale cannot cover is refused at once (before, it opened and failed at completion).
- Open tasks count against the money a point of sale can spend.

- The ledger (`GET /office/finance`) lists holds and releases beside the money movements; each row carries `reason`
  and `held`. Its page cursor now joins the filter instead of replacing it.

## Checked

`esim-ops.spec.ts` (a task holds its price and a rejection frees it; a task the wallet cannot cover is refused before
anything is written), `wallets/deduct.spec.ts` (child → parent with reason and note on both entries; branch over any
account; grandchild, sibling, self, missing note, unknown reason refused), route table and matrix, `tests/account-head.spec.ts`
(five cards, available less held, the deduct dialog). On Docker: an eSIM request held 5 ₪ and its cancel freed it; the
agent took 10 ₪ back from its point of sale as a correction; the ledger shows release, hold, deduct with their reason.
