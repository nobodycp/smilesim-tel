# Activation result: provider-issued eSIM and a clear success screen

## Goal

1. When a new line is activated and the package runs **immediately** (no branch task), the simulated
   provider hands back what the customer needs: the number, the SIM serial, and — for an eSIM — the
   QR picture. Those values are saved on the line at once, so the line card shows them without any
   employee step.
2. Whoever activates a number (POS catalog or the branch "activate" dialog) sees an unmistakable
   result: a check mark, "activated", the number, the serial, the QR when there is one, and one
   "OK" button that takes them to the office home page.

## Decisions

- **Provider output (API, `activate`)**: when `runsNow` and the input shape is `generated`:
  - eSIM: serial = company prefix + random digits, padded to the company length (19 when the
    company sets none); QR = a PNG data URL rendered from an `LPA:1$…` activation string with the
    `qrcode` package (server side, no new web dependency). Both are written to `Line.iccid` /
    `Line.esimQr`.
  - Physical SIM: the typed serial is kept as before; `esimQr` stays null.
- **Response shape**: `ApplyResult` gains an optional `line` block when `applied` is true:
  `{ id, msisdn, iccid, esim, esimQr }`. Task outcomes keep `{ applied: false, taskId }` only.
- **Activation tasks** are unchanged: the employee enters the serial and uploads the QR at completion
  (already built).
- **Result dialog (web)**: a shared `ActivationResult` dialog, `size="confirm"`, mark `check` with a
  new `success` tone, title "تم التفعيل". Body: number, serial, QR tile when present, and the debit
  note. Footer: one primary "موافق" that routes to `/`. When the activation became a branch task, the
  same dialog uses the `plus` mark, title "أُرسلت مهمة للفرع", and the same "OK → home".
- Closing the dialog by Escape or the scrim also goes home; there is no second way out.
- The dialog replaces the inline note for activation on `/packages` (POS) and `/numbers` (branch).
  Other operations keep their inline notes.

## Non-goals

- Real provider integration. The serial and QR are simulated output.
- Printing or sending the QR to the customer (email/WhatsApp). The screen shows it; the line card
  keeps it.
- Changing what branch tasks require at completion.
