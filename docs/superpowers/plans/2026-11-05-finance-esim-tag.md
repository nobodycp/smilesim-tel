# Plan: finance eSIM tag

Spec: `docs/superpowers/specs/2026-11-05-finance-esim-tag.md`

1. Schema: add `esimPrice Int?` to `WalletEntry`; migration `20261105110000_wallet_entry_esim_price`.
   Files: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261105110000_wallet_entry_esim_price/migration.sql`.
2. Service: `Sale.esimPrice?: number`; `move()` writes it; set it on immediate eSIM activation, on settled `activate` tasks with `task.esim`, and on settled `esim` tasks; `finance()` returns `esimPrice`.
   Files: `apps/api/src/modules/office/office.service.ts`.
3. Test: HTTP spec asserting an eSIM activation's finance entry carries `esimPrice` and a plastic one carries `null`.
   Files: `apps/api/src/modules/office/office-lists.spec.ts` (or the closest existing finance spec).
4. Web: `FinanceRow.esimPrice`; kind cell renders the `eSIM` badge with the fee; copy key `esimTag` in ar/en/he.
   Files: `apps/web/lib/api.ts`, `apps/web/app/finance/page.tsx`, `apps/web/lib/copy/{ar,en,he}.ts`.
5. Verify: API tests, typecheck, rebuild + restart API, migrate, browser check of `/finance` after an eSIM activation.
