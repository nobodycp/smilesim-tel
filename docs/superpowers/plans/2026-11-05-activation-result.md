# Plan: activation result

Spec: `docs/superpowers/specs/2026-11-05-activation-result.md`

1. **Provider output** — `apps/api`: add `qrcode` dependency; `office-rules.ts` gets `issueSerial(sim)`
   (pure, tested); new `office-esim.ts` renders the QR data URL; `office.service.ts#activate` stores
   serial + QR on the immediate path and returns `line` in the result. `esim-ops.spec.ts` covers the
   immediate eSIM activation and pins the `line` keys (`id`, `msisdn`, `iccid`, `esim`, `esimQr`).
2. **Web types and copy** — `lib/api.ts` `IssuedLine` + `ApplyResult.line`; copy keys `activated`,
   `activatedLede`, `activationSent`, `activationSentLede`, `ok` in ar/en/he.
3. **Dialog** — `components/dialog.tsx` adds mark `check`, tone `success`, and a `className` prop;
   `dialog.css` adds the success mark tone and `.dialog-result` sizing; new
   `components/activation-result.tsx`.
4. **Screens** — `app/packages/page.tsx` (`PosCatalog.join`) and `app/numbers/page.tsx` (`activate`)
   keep the result in state and show the dialog instead of the inline note; "OK", Escape, and the
   scrim all route to `/`.
5. **Verify** — API tests, web tsc/lint/check:copy, browser: POS activates an eSIM on an immediate
   package → dialog with check, number, serial, QR → OK → home; line card shows serial + QR.

Status: done 2026-11-05. Verified in the browser as admin (`/numbers` dialog, AR light and EN dark,
immediate and branch-task outcomes) and as POS (`/packages` catalog); the new line's card shows the
issued serial and QR.
