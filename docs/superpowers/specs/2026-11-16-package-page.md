# The package page: start tab, eSIM, numbers by account, new operations — spec

Owner, 2026-11-16, after pausing the durations-and-deals plan at D.3b (the provider integration comes next and
will bring a package's durations from the provider):

1. «الأرقام القديمة وتغيير سعرها بدي تضيفه بتاب جديد يبين كل مستخدم داخل الرزمة وكم رقم عنده وأكشن لتعديل السعر عنده
   بدل ما هو موجود في الأسعار».
2. «تفعيل الإيسيم على الرزمة خليه على صفحة البداية للرزمة وسعر الإيسيم مخفي، لما يتفعل خيار الإيسيم بيطلع بنفس
   المكان».
3. «الواجهة الرئيسية للرزمة بدي يكون فيها التفاصيل كم جيجا وباقي التفاصيل، وبنفس الوقت التفاصيل تظهر لنقطة البيع
   بشكل جميل على الرزمة نفسها لما يختارها، ويبين في حال كان ممنوع الفصل عليها أو عرض».
4. «النيود والتحويل من كرت لفاتورة: في واجهة تفاصيل الرزمة أول تاب خيار تفعيل أو فصل، والديفولت دايماً واقف، ولما
   يتشغل يختار العملية وين تروح: مهمة فرع أو مباشر».

## Today

- The package page (`apps/web/features/catalog/screens/package-sheet-screen.tsx`) opens on «سلسلة الأسعار». Its
  «نظرة عامة» tab shows two counts, the provider, the for-sale badge and the package facts
  (`components/package-facts.tsx`).
- «الرزمة متاحة كـ eSIM» is a checkbox in the «التفاصيل» tab (`package-details-form.tsx`, saved with the details by
  `PATCH packages/:code/details`); the eSIM price is a card in «سلسلة الأسعار», saved with the chain
  (`PATCH packages/:code/chain`, `esimPrice` null = inherited).
- Re-pricing the numbers already on the package is the last card of «سلسلة الأسعار»: pick an account or all, open
  the line-prices dialog (`pricing/terms.service.ts` `linePrices`, `setLinePrices`, `repriceLines`).
- A package's operations and how each runs are the «إجراءات الرزمة» tab (`catalog/rules/run-modes.ts`
  `ACTION_KEYS`: auto, manual (a branch task) or off, or following the provider).

## Target

### P.1 eSIM on the start tab

- «نظرة عامة» carries a switch «الرزمة متاحة كـ eSIM». Off: nothing more. On: the eSIM price field appears in the
  same place, with the line that says which price holds now and where it comes from, and its own save.
- The checkbox leaves «التفاصيل» and the price card leaves «سلسلة الأسعار». The routes and the stored fields do not
  change: the switch saves `esimAvailable` through the details route, the price through the chain route.

### P.2 The start tab shows the package

- «نظرة عامة» shows the package's details: data, minutes, messages, the extra text, the duration, and the days before
  a number counts as suspended, beside the counts and the provider.
- Owner, 2026-11-16: the details are **edited** there and the «التفاصيل» tab goes. The facts line above the form is
  how a point of sale reads them.

### P.3 «أرقام الحسابات» tab

- One row per account that has numbers on the package: the account, its layer, how many numbers, how many of them
  are active, and «تعديل السعر», which opens the existing line-prices dialog for that account. A first row «كل
  الحسابات» opens it for all.
- The re-pricing card leaves «سلسلة الأسعار». The dialog and its routes do not change.
- API: `GET /v1/packages/:code/line-accounts` — the points of sale that hold numbers on the package, counted by
  the database, with the viewer's usual visibility (branch only, as the sheet).

### P.4 What the point of sale sees

- The package card the point of sale picks from shows the same details, laid out as facts.
- A mark for «لا تُفصل» and one for «عرض». Both come from the paused plan (the lock, D.4; deals, D.7): until they
  exist there is nothing true to show, so the marks are built with them, not before.

### P.5 Porting and card-to-bill

Two operations a package may offer: **number porting** («نيود») and **converting a prepaid card to a bill**
(«تحويل من كرت لفاتورة»). On the start tab each has a switch, **off by default for every package** (also for one
made from a provider whose mode is on), and when on, a choice of where the request goes: a branch task, or
directly to the provider.

Open, before anything is built:

- **A.** What does the point of sale enter for a porting: the number to bring, the company it leaves, the
  subscriber's identity number, a document? And for card-to-bill?
- **B.** Is a porting a way to **activate** a new number on the package (the number arrives from another company),
  or an operation on a number that is already ours?
- **C.** Does each have a price for the point of sale, and a cost at the provider?
- **D.** «مباشر» needs a provider that carries the operation. Until the first provider is connected, does choosing
  it open a branch task as every other operation does when the provider cannot run it?

## Non-goals

- No change to prices, to the line-prices dialog's rules, or to what an eSIM costs.
- No new place for run modes: the other operations stay in «إجراءات الرزمة».
