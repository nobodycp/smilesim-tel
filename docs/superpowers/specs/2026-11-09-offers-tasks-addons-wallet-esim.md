# Offers hero, task notes and statuses, line add-ons, wallet page, eSIM per package

Date: 2026-11-09 · Status: approved by the request (chat 2026-11-09) · Plan: `docs/superpowers/plans/2026-11-09-offers-tasks-addons-wallet-esim.md`

## 1. Offers (الإعلانات) — a hero carousel on every account's home

Owner: «افضل نظام اعلانات للمستخدمين… صور وكلام علي شكل هيرو… شغال او نوقفه او نضيف او نحذف… تنقل… المدة… المستخدم بيقدر يتجاوز… ديسكتوب وموبايل».

- Model `Offer`: `title` (≤80), `body` (≤240), `image` (a data URL, at most 700 KB, png/jpeg/webp), optional `actionLabel` (≤30) and `actionHref` (an office path starting with `/`, or `https://`), `seconds` (how long it stays before the next, 3–60, default 7), `active`, `position` (order), `layers` (who sees it: any of main_agent, agent, pos, branch; default all), optional `startsAt` / `endsAt`, timestamps.
- Managed on `/offers` (sidebar «الإدارة» → «الإعلانات»), by the branch owner and staff with the edit grant: list with a live/stopped switch, add, edit, delete, move up and down, and a preview.
- `GET /office/offers/live` gives the signed-in account the active offers for its layer, inside their dates, in order. `GET/POST/PATCH/DELETE /office/offers…` manage them.
- The home of every layer opens with the hero when it has at least one live offer: image and text side by side on desktop, stacked on mobile; the dots under it; arrows on desktop; swipe on touch; keyboard left and right. It moves to the next offer after that offer's `seconds`; a dot, an arrow or a swipe moves at once and the timer starts again on the chosen offer. It pauses while the pointer is over it, while it has focus and while the tab is hidden; with reduced motion it does not auto-advance. One offer shows without dots or timer.

## 2. Tasks: internal notes and three statuses

Owner: «ملاحظات داخلية للفرع والموظفين… وحالتها قيد المعالجة، مغلق، تمت المعالجة، لا داعي لحالة قيد الاستلام».

- A note can be **internal** (`OfficeTaskNote.internal`): only branch-layer accounts (the owner and the staff) read it. The other readers of the task do not receive it in the task, the list's last note, or a notice.
- Statuses as shown: **قيد المعالجة** (open), **مغلق** (closed without being done: rejected or cancelled), **تمت المعالجة** (done). A new task opens as `working`; there is no «بانتظار الاستلام». Existing `pending` tasks become `working` (migration).
- Any branch account that may handle tasks completes or closes an open task directly; taking it is optional (it names the handler, «يعالجها …») and releasing removes the name. The stored values stay `working`, `done`, `rejected`/`cancelled`, so money, holds and reports are unchanged.

## 3. Line add-ons (العمليات الإضافية)

Owner: «عمليات اضافية بتسير على الارقام، بندخل اسمائها يدوياً داخل الرزم، وبتتحول للمهام». They were planned for later in `docs/project-plan.md` and never built.

- Model `PackageAddon`: `name` (≤60), `price` (agorot, what the point of sale pays; 0 allowed), `active`, `position`, per package. Edited in the package page's tab «العمليات الإضافية» (branch owner or edit grant).
- On a number's card, «عمليات إضافية» lists its package's active add-ons. Choosing one opens a manual task (`action: 'addon'`, the add-on's name on the task) that holds the price like other manual operations; the balance moves when the task is marked done, and a closed task releases the hold.
- The add-on's name shows in the task, the line history, the finance row and the reports.

## 4. Wallet page (`/wallet`)

Owner: «صفحة محفظة خاصة… من الايقونة في الأعلى، آخر شي بالبار كلمة المحفظة… للشحن مستقبلاً».

- The topbar's wallet chip carries the word «المحفظة» and the balance, and opens `/wallet` (no popover).
- `/wallet`, every layer: balance, ceiling, used, held, available; the 30-day chart; the account's own movements (paged); and a «شحن الرصيد» button that says it is coming soon (top-up requests are a later slice).

## 5. eSIM per package

Owner: «رزم ما فيها ايسيم… خيار نحدده من داخل الرزمة».

- `Package.esimAvailable` (default true), set in the package's «التفاصيل» tab. A new activation offers eSIM only when both the company and the package allow it; the API refuses an eSIM activation otherwise (`ESIM_UNAVAILABLE`).

## Order

5 → 4 → 2 → 3 → 1 (small to large), each verified on Docker in ar + en, light + dark, desktop and mobile widths, then committed.
