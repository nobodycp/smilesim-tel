# Gap roadmap — what the ZANDARD offer lists and we build now

Date: 2026-11-08 · Source: owner's decisions in `docs/project-plan.md` → 2026-11-08 · Status: approved scope, slices
not started. Each slice gets its own spec before code (`work-plan.mdc`); money and status slices need the owner's
answers listed under "Needs the owner" first.

## Now, in this order

| # | Slice | Needs the owner | Size |
|---|---|---|---|
| N1 | Server-side idempotency for every write (an `Idempotency-Key` per action, kept 24 h in Redis; a repeat answers the first result) | — | S |
| N2 | Days left and «ينتهي قريباً» (≤ 3 days) on numbers: a column, a filter, and a card on every layer's home | — | S |
| N3 | Package details and offers: GB, SMS, minutes, duration (months), renewal price after the offer, an «عرض» flag with a badge | confirm the renewal rule | M |
| N4 | Profit per layer: what each layer earned on its sales (its price minus the price above), on the home cards and in a report | — | M |
| N5 | Reports like the offer: sales, profits, orders (operations and tasks), balances, providers — each with search, filters and CSV | — | L |
| N6 | Full wallet: deposit, withdraw, transfer, hold, deduct, refund; debts, credit limits, spending limits | meaning of each movement | L |
| N7 | Provider accounts: balance (current / available / held), purchases, payments, settlements, credit limit, a ledger per provider | how providers are paid today | M |
| N8 | Reconciliation: import a provider statement, match it against our operations and balances, list missing, duplicate and different rows | what the providers send | M |
| N9 | Sign-in: Passkeys; 2FA by SMS and by email beside the authenticator app (the default), chosen by the user | SMS gateway, mail account | L |
| N10 | Automated database backups with retention and a restore check | where to keep them | S |

## Later (recorded, not planned)

Provider API integration (to be discussed again with the providers' documents), inventory, top-up requests with
proof, customers, a maximum sell price, WhatsApp and email notifications.

## Not wanted

An alternative source per product.
