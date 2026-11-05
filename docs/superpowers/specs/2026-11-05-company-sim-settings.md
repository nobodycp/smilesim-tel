# Company settings: SIM length, SIM prefix, eSIM

Goal: the company page (`/companies/:code`) gets a settings tab where the branch records how a company's SIMs look: how many digits the ICCID has, the prefix it starts with, and whether the company takes eSIM. The server enforces them on activation and SIM swap, and the forms help the user meet them.

Today the company page only lists providers, and every company accepts any ICCID of 8 characters or more.

## Decisions

### Data

- `Company` gets three columns:
  - `iccidLength Int?`: the exact ICCID length. Empty means the length is not checked.
  - `iccidPrefix String?`: one prefix, digits only. Empty means the prefix is not checked.
  - `esim Boolean @default(true)`: whether the company takes eSIM. Existing companies keep working as today.
- One prefix per company. No list.

### Rules (server, the source of truth)

- A pure function in `office-rules.ts`, `simRefusal(rules, iccid)`, returns the refusal code or `null`:
  - When a length or a prefix is set, the ICCID is digits only, else `SIM_DIGITS`.
  - When a length is set, the ICCID has exactly that many digits, else `SIM_LENGTH`.
  - When a prefix is set, the ICCID starts with it, else `SIM_PREFIX`.
  - When neither is set, it returns `null` and the caller keeps today's checks (`length >= 8` where it applies today).
- Activation: whenever an ICCID is taken (every mode except a generated eSIM), it passes `simRefusal` with the package's company rules. An eSIM request on a company with `esim = false` is refused with `ESIM_UNSUPPORTED`.
- SIM swap: the new ICCID passes `simRefusal` with the line's company rules.
- The rules are checked when the request arrives, so a request that becomes a task was already checked. Completing a task does not check again.
- Stored ICCIDs are never re-checked. Changing a rule only affects new input.

### New error codes

Fixed text, like every other code (the exact length and prefix are shown by the form hint, not in the error):

| Code | Arabic |
| --- | --- |
| `SIM_DIGITS` | رقم الشريحة أرقام فقط |
| `SIM_LENGTH` | عدد خانات الشريحة لا يطابق الشركة |
| `SIM_PREFIX` | رقم الشريحة لا يبدأ بمقدّمة الشركة |
| `ESIM_UNSUPPORTED` | الشركة لا تدعم eSIM |

English and Hebrew text go into `en.ts` and `he.ts`; `check:copy` enforces it.

### API

- `GET /office/companies` (branch shelf): each company gains `sim: { length: number | null; prefix: string; esim: boolean }`.
- `PUT /office/companies/:code/sim` with body `{ length: number | null; prefix: string; esim: boolean }`:
  - Branch layer; the branch owner or an account with the `edit` grant (same gate as provider modes).
  - `length` is `null` or an integer from 10 to 22. `prefix` is `''` or 1 to 10 digits, and shorter than `length` when a length is set. Otherwise `INVALID`.
  - Unknown company is `NOT_FOUND`.
- `GET /office/packages`: each package row gains `sim` with its company's rules.
- `GET /office/lines/:id`: `line.sim` with the line's company rules.

### Company page

- Two tabs in `.steps`, like the provider page: "Company settings" (opens first) and "Providers" (today's table).
- The settings tab is one form inside the pane body: SIM length (numeric), SIM prefix (Latin digits, `dir="ltr"`), and "Supports eSIM" (`label.check`), then Save. The fields sit in a row that fills the pane and wraps on a narrow window.
- Save sends the three values; the note banner confirms, the error banner shows a refusal.
- Read-only users see the values with the controls disabled.

### Activation and SIM swap forms

- The ICCID field starts with the company prefix filled in when it is empty, and refills it when the package (and so the company) changes.
- Under the field, a hint names the rule, e.g. "19 digits, starts with 8997202", in the language of the screen.
- The submit button stays disabled until the ICCID meets the rule (the server checks again).
- The eSIM checkbox is hidden when the company does not take eSIM, and an eSIM choice is cleared when switching to such a company.
- Applies to the point-of-sale catalog (`/packages`), the branch activation dialog (`/numbers`), and the SIM swap dialog (`/numbers/:id`).

## Later tasks (not in this change)

- Phone number prefixes per company.
- A note to the point of sale on the activation form.
- More than one SIM prefix per company.

## Non-goals

- Checking or rewriting ICCIDs already stored on lines or tasks.
- Changing the phone number format check (`05` + 8 digits).
- Company name or image editing on this page.
