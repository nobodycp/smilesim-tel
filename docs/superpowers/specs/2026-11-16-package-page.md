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

Owner's answers, 2026-11-16:

- **Both are ways to activate a new number on the package**: the number is not one of ours yet. The request is an
  activation with a kind (`port` or `convert`).
- **The point of sale enters the number and the serial, nothing else.** No eSIM. Later (not now): the sale price,
  the customer's name and whether the customer paid, so a point of sale can manage its customers.
- **No cost of their own**: the task holds and charges the package's activation price, as any activation does.
- **«مباشر» opens a branch task** until a provider that carries the operation is connected.

So: `Package.portMode` and `convertMode` (`off`, `manual`, `auto`), `off` for every package; `POST lines` takes
`kind`; a kind is refused while its mode is off, and opens a branch activation task marked with
`Task.activationKind`, whichever mode is set. The task's completion is the ordinary activation's.

### P.6 The point of sale's flow: one question at a time

Owner, 2026-11-16, after five interactive shapes (`docs/prototypes/2026-11-16-activation-variants.html`): the
«سؤال واحد» shape, with the package cards of the «تذكرة» shape (the data as a ring), fit for a phone, with the
motion of the prototype.

- One screen, three questions in turn: «أي شركة؟», «أي رزمة؟», «لمن الاشتراك؟». Picking an answer closes the
  question and opens the next; the answers given sit above as lines, each with «تغيير» that goes back to it.
- A bar fills by thirds. The question in hand rises in (no motion when the system asks for none).
- A package card: a ring that draws the package's data against the company's largest package, the name and the
  duration beside it, minutes and messages with their icons, the price in the accent colour.
- A digit key picks the company or the package that carries that digit (not on a touch screen, not while typing).
- A pay bar under the question: what is being bought, the wallet now and after, and the activate button with the
  price on it.
- The request, its fields and its rules do not change.

### P.7 The marks on the card, the customer's name, the cards' look

Owner, 2026-11-16:

- **«عرض» and «لا تُفصل» show on the package card now.** «عرض» is a mark the branch sets on the package (a switch on
  «نظرة عامة») with a short line that says what the offer is; it changes no price and no renewal — the offers of the
  paused plan will replace it. «لا تُفصل» is true today without a new setting: it shows when the package's disconnect
  operation is off, which is what makes a number on it impossible to disconnect.
- **The customer's name** is a field on the subscribe step **as a shape only**: nothing is sent or kept until the
  customer record is built (with the sale price and whether the customer paid).
- **The cards**: the admin's company card (cut corner, inset edge), the company's whole picture centred, its name
  and its package count; no numbering anywhere, and no digit keys.
- The eSIM box was stretched to 44px on a phone: the checkbox keeps its square in any row.

### P.8 An offer's card stands out

Owner, 2026-11-16: «لما تكون الرزمة عرض اعمل تأثيرات بصرية وغيّر لونها إلى لون أجمل مع تحريك وألعاب نارية على الرزمة
نفسها».

- A package marked as an offer has a gold card at the point of sale: a gold edge, a wash from gold to the accent,
  a gold data ring.
- It moves: the edge breathes, a sheen crosses the card, and four small bursts of sparks go off in turn, behind
  the card's content so nothing covers the text or takes a click.
- With less motion asked for by the system, the card is gold and still.

## Non-goals

- No change to prices, to the line-prices dialog's rules, or to what an eSIM costs.
- No new place for run modes: the other operations stay in «إجراءات الرزمة».
