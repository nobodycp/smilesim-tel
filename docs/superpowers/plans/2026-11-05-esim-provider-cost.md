# Plan: eSIM fee in provider operations

Spec: `docs/superpowers/specs/2026-11-05-esim-provider-cost.md`

1. **Failing tests** — `apps/api/src/modules/office/esim-ops.spec.ts`: immediate eSIM activation entry
   carries `providerCost = 2000 + 400`; eSIM request closed through its task carries `providerCost = 400`;
   physical activation keeps `providerCost` unset. `provider-operations` rows read it back (existing
   `cost: row.providerCost ?? priced.cost`).
2. **Service** — `apps/api/src/modules/office/office.service.ts`: `activate()` immediate path passes
   `providerCost` in the sale when `esim`; `completeTask()` does the same for an `activate` task with
   `esim`, and sets `providerCost = -task.posDelta` on the `esim` task's sale.
3. **Web filter** — `apps/web/app/provider-operations/page.tsx`: add `esim` to `KINDS`.
4. **Verify** — API tests, web tsc, rebuild + restart API, browser: `/provider-operations` shows the
   activation row at package + eSIM and the eSIM request row at the fee; kind filter lists "طلب eSIM".
   One-off dev backfill of the two existing eSIM rows, script kept in `/tmp`.

Status: done 2026-11-05. `activationProviderCost` in `office-rules.ts`; `activate()` and `completeTask()`
write `providerCost` for eSIM activations and eSIM requests; `/provider-operations` lists `esim` in the kind
filter. Also fixed, same function: activation on a provider that takes the typed serial (`neod`, `tokman`)
kept the eSIM fee but stored the line as a physical SIM; the line now stays `esim: true` with its serial.
Verified in the browser: new eSIM activation row 35.00 + 5.00 = 40.00 ₪; eSIM request row 5.00 ₪; filter
"طلب eSIM" works. Dev rows backfilled (10 activations + 1 request).
