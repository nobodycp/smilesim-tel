# eSIM price, eSIM request, serial and QR on lines, line detail layout

Goal: the office prices an eSIM per company with provider and package overrides, keeps the eSIM serial and the QR image the branch received for a line, tells a physical SIM from an eSIM on the list and the card, adds an "eSIM request" operation that becomes a branch task where the employee attaches the new QR and serial, lets the employee enter the new number when a number change is a task, and the line details tab shows serial, QR, last recharge, and fills a desktop width.

Today a line stores `iccid` and an `esim` flag. A generated eSIM stores `iccid = null`. The eSIM fee is a constant `ESIM_FEE = 5 ₪` charged only on activation. SIM swap writes a physical ICCID and is free. A number change requires the new number at request time, and task completion takes only a note. The details tab stacks every row across the full width.

## Decisions

### eSIM price

- `Company.esimPrice Int @default(500)` (agorot): the default price of an eSIM for every package of the company.
- `Provider.esimPrice Int?`: when set, overrides the company price for packages of that provider.
- `Package.esimPrice Int?`: when set, overrides both.
- Resolution, one pure function in `office-rules.ts`: `esimPriceOf({ pkg, provider, company })` = `pkg.esimPrice ?? provider.esimPrice ?? company.esimPrice ?? 500`. It replaces `ESIM_FEE` in activation and prices the new eSIM request. Migration `20261105100000_esim_price_and_qr` adds the three columns and `Line.esimQr`.
- The point of sale pays the resolved price; it is a POS debit like the current fee.
- Editing:
  - Company settings tab (`/companies/:code`): the existing SIM form gains "eSIM price" (shekels, required, ≥ 0). `PUT /office/companies/:code/sim` body gains `esimPrice: number` (agorot).
  - Provider settings page (`/providers/:code`): a new "eSIM price" field above the run-mode list with a "use company price" clear control. `PATCH /office/providers/:code/esim-price` body `{ price: number | null }`.
  - Package sheet (`/providers/:code/:packageCode`): the price chain gains "eSIM price" with a clear control. `PATCH /office/packages/:code/chain` accepts `esimPrice: number | null`. The sheet returns `esimPrice` (own value or null) and `esimPriceEffective` with `esimPriceSource: 'package' | 'provider' | 'company'`.
  - `GET /office/packages` rows gain `esimPrice` (effective), so activation forms show the fee they will add.

### Line data

- `Line.esimQr String?`: the QR image as a data URL (`image/png|jpeg|webp`, base64), the same storage as company logos. The client shrinks it to at most 640px on the long side and 300 KB before sending; the server checks the data-URL shape and a 400 KB ceiling.
- An eSIM's serial is its `iccid`. An eSIM line can be in three states: pending (`esim`, no `iccid`, no `esimQr`), with serial only, or with serial and QR.
- `esimCode` and QR generation are dropped; no QR library. The QR is always a picture the provider gave the branch.

### Operations

**SIM swap (`sim`, existing)** — a serial the branch already holds. Free, as today.
- Body `{ iccid, esim?: boolean, qr?: string | null, outcome }`. `iccid` is required and passes `simRefusal`. `esim: true` marks the line eSIM and stores `qr` when given; `esim` false or missing writes a physical SIM and clears `esimQr`. `esim: true` on a company with `sim.esim = false` is `ESIM_UNSUPPORTED`.
- When it becomes a task, the task keeps `iccid`, `esim`; the QR goes to the line only when the task completes (`OfficeTask.esimQr String?` holds it until then).

**eSIM request (`esim`, new)** — the customer wants an eSIM issued (lost SIM, or plastic → eSIM). Priced at `esimPriceOf`.
- Offered on an active, not `opsLocked` line whose company takes eSIM, whether the line is physical or eSIM today.
- Always a branch task; it has no run mode and the outcome picker does not apply. `POST /office/lines/:id/esim` with an empty body opens the task with `posDelta = -esimPriceOf(...)`, `esim: true`, `iccid: null`.
- Completion requires the new serial and the QR image (below). The line then gets `iccid`, `esim = true`, `esimQr`; the old serial and QR are replaced. The debit is posted at completion with `kind = 'esim'`.
- `esim` joins the provider-operation kinds, reports, and `actionName` copy.

**Number change (`rename`, existing)** — the new number may be unknown at request time.
- Request body `msisdn` becomes optional. When present it is validated and checked for `NUMBER_TAKEN` as today. When the action runs now, it is required. When it becomes a task, the task keeps whatever was given.
- Completion requires `msisdn` (prefilled from the task). The line's `msisdn` changes; wallet entries and tasks keep the old number on their own rows, so the old number stays searchable in reports and the line's log, and the line is reached by the new number.

### Task completion

`POST /office/tasks/:id/complete` body gains fields the task's action needs:

| Task | Required | Optional |
| --- | --- | --- |
| `esim` | `iccid` (passes `simRefusal`), `qr` (data URL) | `note` |
| `rename` | `msisdn` (`05` + 8 digits, not taken) | `note` |
| `activate` with `esim` | — | `iccid`, `qr` (the branch may have them already) |
| `sim` with `esim` | — | `qr` |
| others | — | `note` |

The task card completion row grows the fields for that action: serial input (`dir="ltr"`, company hint), QR file picker with a preview, number input. Submit stays disabled until the required fields pass. After completion the task row shows the serial it wrote.

### API shape

- `GET /office/lines` rows and `GET /office/lines/:id` gain `esimQr: string | null`.
- `GET /office/lines/:id` gains `lastRechargeAt: string | null`: the `createdAt` of the newest wallet entry on the line whose kind is `activate`, `charge`, `extend`, or `reactivate`. `null` when none.
- `GET /office/lines/:id` `operations` includes `'esim'` when offered.
- `GET /office/tasks/:id` gains `esimQr: string | null` and the `sim` rules of the task's company (for the completion hint).
- `response-shape.spec.ts` `LINE_KEYS` gains `esimQr`.

### Numbers list (`/numbers`)

- New column "SIM" after the package column:
  - physical: `Badge` muted "شريحة عادية";
  - eSIM with QR: `Badge` muted "eSIM" and a 44px thumbnail button showing the stored QR image; clicking opens the QR dialog;
  - eSIM without QR: `Badge` warning "eSIM بلا رمز".
- Skeleton column count grows by one.

### QR dialog

- `components/esim-qr.tsx`: `SimBadge({ line })`, `EsimMark({ src, label, onOpen })` (44×44 button with the image), `EsimDialog({ line, onClose })` — `Dialog` size `confirm`: the image at up to 280px on a white tile (`--rd-qr-tile`, same in both themes, so the code stays scannable), then number and serial in `<bdi dir="ltr">`, footer one secondary close button.
- `lib/qr-image.ts`: `compactQr(file): Promise<string>` — like `compactImage` but 640px long side, png kept as png (QR edges must stay sharp), 300 KB limit.

### Line card (`/numbers/:id`)

- Head: status badge, then `SimBadge`, then `EsimMark` when the line has a QR.
- Operations tab: a new tile "طلب eSIM" (icon `QrCode`) when `operations` includes `esim`. It opens a confirm dialog naming the price (`esimPrice` from the card) and the fact it becomes a task; confirming calls the endpoint.
- Swap SIM dialog: serial field (today), a `label.check` "شريحة إلكترونية" (hidden when the company refuses eSIM), and when checked a QR file picker with preview (optional). Free. Copy under the checkbox: "لإصدار شريحة إلكترونية جديدة استخدم طلب eSIM".
- Details tab rows in order: company, package, SIM type (`SimBadge`), serial, QR (eSIM with image only: secondary button "عرض رمز QR"), package ends on, remaining days, last recharge, subscription price, point of sale (branch only).
- Details layout: `.detail-rows` becomes a responsive grid of label/value cards: `grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr))`, each card `8.5rem minmax(0, 1fr)`. On a canvas 1100px or wider the details body is two columns: rows take the remaining width, usage takes a 22rem end column.

### Copy

New keys in `ar.ts`, `en.ts`, `he.ts`: `simType`, `physicalSim`, `esimNoQr`, `simSerial`, `esimQr`, `showQr`, `lastRecharge`, `esimPrice`, `esimPriceCompany`, `esimPriceSource`, `useCompanyPrice`, `useInheritedPrice`, `requestEsim`, `requestEsimHint`, `swapEsimHint`, `newNumber`, `qrImage`, `pickQr`, `qrTooLarge`, `actEsim`. `check:copy` enforces parity.

### Tests

- `office-rules.spec.ts`: `esimPriceOf` precedence (package > provider > company > 500).
- `esim-ops.spec.ts` (new, same harness as `operation-log.spec.ts`): eSIM request opens a task priced from the company default, from a provider override, from a package override; refused with `ESIM_UNSUPPORTED` when the company refuses eSIM; completing it with serial + QR writes the line and posts the debit as `esim`; completing without a QR is `INVALID`; swap with `esim: true` marks the line and is free; rename task completion with a new number updates the line and refuses a taken number.
- `response-shape.spec.ts`: `esimQr`, `lastRechargeAt`.
- Browser: `/numbers`, `/numbers/:id`, `/tasks/:id`, company settings, provider settings, package sheet; Arabic and English, light and dark, 1440px and a narrow window.

## Non-goals

- A live provider connection; the QR is always attached by a person.
- Reading an EID from the device.
- Changing activation inputs for Neod / Tokman.
- Changing the `/packages` catalog beyond showing the eSIM fee it already adds.
- Usage meter data; they stay placeholders.
