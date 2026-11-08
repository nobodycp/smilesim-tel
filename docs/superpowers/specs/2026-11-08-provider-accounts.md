# Provider accounts (roadmap N7)

Date: 2026-11-08 · Status: done · Owner rules: `docs/project-plan.md` → 2026-11-08 («حسابات المزودين»)

Owner: we pay each provider in instalments, our balance with a provider may go negative, and a staff member with the
accountant role enters the payments.

## Design

- **Balance with a provider** = payments + settlements − purchases. Purchases are what our operations cost at that
  provider: the same `providerCost` the provider-operations report shows (wallet entries of line operations whose line
  belongs to the provider's package). Negative means we owe the provider.
- **Held** = the provider cost of our open tasks (pending or working) on that provider's packages: money about to be
  owed. **Available** = balance + credit limit − held.
- **Credit limit** per provider (`Provider.creditLimit`): how far we may owe it.
- **Payments and settlements** are entries of their own (`ProviderEntry`: `payment` positive, `settlement` positive or
  negative, always with a note), entered on the provider's page.
- **Ledger per provider**: purchases and entries together, newest first, with the running balance; dates filter; CSV.

API: `GET /office/provider-accounts`, `GET …/:code?from&to`, `GET …/:code/export`, `POST …/:code/entries`
`{ kind, amount, note }`, `PATCH …/:code/credit` `{ creditLimit }`.

Who: reading needs the branch owner or the `accounting` or `reports` grant; writing (payments, credit limit) the owner
or the `accounting` grant — the accountant role the owner described. (ADR 0006 keeps `accounting` unenforced on the
existing screens; this new screen uses it from the start.)

Web: «حسابات المزودين» in the sidebar (branch, under providers): a table of providers with balance, credit, held,
available; each opens its page — four cards, «تسجيل دفعة», «حد الائتمان», the ledger with dates and CSV.

## Checked

`providers/provider-accounts.service.spec.ts` (sums, held for open tasks, ledger running balance and dates, payments,
settlements of either sign, credit limit, refusals), route table and matrix (owner and the accountant), 
`tests/provider-accounts.spec.ts`. On Docker: five providers listed from the trial operations (sky −632.88 ₪, alloha
−95 ₪ with 60 ₪ held); a 300 ₪ payment and a 1,000 ₪ credit limit on alloha → balance +205 ₪, available 1,145 ₪; the
agent is refused; the ledger CSV opens.
