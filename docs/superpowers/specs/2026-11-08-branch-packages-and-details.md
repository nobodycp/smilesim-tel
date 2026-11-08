# Branch packages list with prices and switch; package details

Date: 2026-11-08 · Status: done · Owner: «في الرزم في الإدارة بدل الأرقام الفعالة والموقوفة، العرض زي المستخدمين والأسعار: الأسعار، وبدل الحالة زر الإيقاف والتشغيل. السعر سعر الابن في السلسلة فقط مع الهامش. المزود والرزمة والشركة باينين. وتفاصيل الرزمة بالداخل: كم جيجا، كم رسالة، كم دقيقة، وتفاصيل إضافية تظهر عند اختيار الرزمة من نقطة البيع أو عند تفعيل رقم»

## 1. The branch packages list (`/packages` on the branch door)

Today: a flat table — package, company, provider, a status badge, active numbers, stopped numbers.

Now, in the users tab's shape (`packages-terms.tsx`):

- Grouped by company; each company folds (open when searched or filtered). Its head: name and «N رزمة · M متوقفة».
- One line per package: the package name with its facts (GB, minutes, messages, months), the provider, **the child's
  price** — the main agent's subscription / renewal price (`mainPrice` / `renewalMainPrice`) — and **the margin**
  (`mainPrice − branchCost`). The other ladder prices are not shown here; they stay on the package page.
- The status badge becomes the on/off switch (`PATCH /office/packages/:code/mode { enabled }`), green on, red off,
  before the row menu. The row menu opens the package page.
- Filters stay: package, company, provider, status.
- Active/stopped number counts leave the list (the package page keeps them).

## 2. Package details

- New on `Package`: `smsCount Int?`, `minutes Int?`, `details String?` (up to 300 characters). `dataGb` and `months`
  exist. For `dataGb`, `smsCount`, `minutes`: null = not stated (not shown), −1 = unlimited, otherwise the amount.
- Edited by the branch (same rule as the price chain: branch with the edit grant) in a new «التفاصيل» tab on the
  package page: GB, minutes, messages (each with «غير محدود»), extra details. `PATCH /office/packages/:code/details`.
- Shown wherever a package is chosen:
  - the point of sale's packages page: on each package card, and on the subscribe step;
  - «تفعيل رقم» on the numbers page (anyone allowed to activate): under the chosen package;
  - the branch list (§1) and the package page overview.
- Read through `GET /office/packages` (each row gains `smsCount`, `minutes`, `details`), `GET /office/companies`
  (each package gains `dataGb`, `smsCount`, `minutes`, `branchCost`, `mainPrice`, `renewalBranchCost`,
  `renewalMainPrice`) and the package sheet. Additions only; no field changes meaning.

## Checked

`response-shape.spec.ts` (shelf and sheet keys; details saved with -1 and null, trimmed, ranges, point of sale refused),
route table and matrix, `tests/branch-packages.spec.ts` (folded list, child price, margin, switch sends `enabled`,
filter opens its company, the details tab saves, the point of sale card and subscribe step). On Docker: screenshots of
the branch list in Arabic light and English dark, the details tab, and the point of sale's subscribe step with details.
