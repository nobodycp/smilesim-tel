# Gap roadmap — what the ZANDARD offer lists and we build now

Date: 2026-11-08 · Source: owner's decisions in `docs/project-plan.md` → 2026-11-08 · Status: approved scope, slices
not started. Each slice gets its own spec before code (`work-plan.mdc`); money and status slices need the owner's
answers listed under "Needs the owner" first.

## Now, in this order

| # | Slice | Needs the owner | Size |
|---|---|---|---|
| N1 ✅ | Server-side idempotency for every write (an `Idempotency-Key` per action, kept 24 h in Redis; a repeat answers the first result) | — | S |
| N2 ✅ | Days left and «ينتهي قريباً» (≤ 3 days) on numbers: a column, a filter, and a card on every layer's home | — | S |
| N4 ✅ | Profit per layer: what each layer earned on its sales (its price minus the price above), on the home cards and in a report | — | M |
| N5 ✅ | Reports like the offer: sales, profits, orders (operations and tasks), balances, providers — each with search, filters and CSV | — | L |
| N6 ✅ | Full wallet, every layer: every entry names its operation and reason; deposit and deduct (consumption, correction, settlement); the parent takes money back from a child with a note (no transfers); an automatic hold when a task opens, released or charged when it closes; the spending limit is today's ceiling | — | L |
| N7 ✅ | Provider accounts: balance (may go negative), purchases from our operations, payments in instalments entered by a staff member with the accountant role, settlements, credit limit, a ledger per provider | — | M |
| N8 ✅ | Reconciliation: upload a provider's Excel statement (a column map per provider; API pull later), match it against our operations and balances, list missing, duplicate and different rows | each provider's columns, at the start | M |
| N9 | Sign-in: Passkeys; 2FA method choice (authenticator app by default, SMS, email) on a pluggable sender — gateways chosen later | — | L |

## Later (recorded, not planned)

Provider API integration (to be discussed again with the providers' documents), inventory, top-up requests with
proof, customers, a maximum sell price, WhatsApp and email notifications, package offers and details (long
discussion pending), automated backups, add-ons (today a manual line task; later a priced task charged on completion).

## Not wanted

An alternative source per product. Orders with a quantity for one customer.

## Done

- N1 `4c5059e` — duplicate writes refused or replayed on the server (spec `2026-11-08-duplicate-writes.md`).
- N2 — days left on every active number (a warning badge at 3 days or less), `status=expiring` filter, «ينتهي قريباً» card on every home (`expiringLines`).
- N4 — profit per layer: `WalletEntry.ladder` snapshot, `margin` on finance rows, `profit` over 30 days on finance and home (spec `2026-11-08-layer-profits.md`); refunds take back their share; «الأرباح» page by package and period with CSV.
- N5 — «التقارير» (`/reports`): sales, profits, orders, balances, providers; dates, filters, CSV (spec `2026-11-08-reports.md`).
- N6 — full wallet: reasons on deposits, «خصم» (child → parent with a note), automatic hold for open tasks, available = balance + ceiling − held (spec `2026-11-08-full-wallet.md`).
- N7 — provider accounts: balance = payments + settlements − purchases, credit limit, held for open tasks, ledger with running balance and CSV (spec `2026-11-08-provider-accounts.md`).
- N8 — reconciliation: upload a provider statement (xlsx/csv), pick its columns (kept per provider), compare with our operations, follow each difference (spec `2026-11-08-provider-reconciliation.md`).
