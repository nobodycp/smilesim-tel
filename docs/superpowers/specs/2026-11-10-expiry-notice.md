# Notice before a subscription ends — spec

Owner, 2026-11-10: «بدنا نعمله إشعار، وبنفس الوقت إشعار نقدر نربطه في الـ SMS مستقبلاً».

## Today

- A number is "expiring" when it is active and ends within `EXPIRING_DAYS` (3) from now
  (`rules/office-paging.ts` `expiringWhere`). It is a filter (`GET /office/lines?status=expiring`) and a count on
  the home. Nobody is told: an account learns of it only by opening the list.
- Notices are rows of `Notice` written inside a transaction by `NoticeService.write` and pushed live to the
  browser; a kind has a payload type, a group and a link (`notices/notice-kinds.ts`). The web words them
  (`apps/web/lib/notice-text.ts`).
- Outgoing messages have one port, `MessageSender` (`auth/message-sender.ts`), with one implementation that only
  logs. No SMS gateway exists.

## Target

1. **One event per number, per period.** When a number enters the window it is marked once for that end date:
   `Line.expiryNoticedFor` (the `endsAt` it was announced for, null before). A renewal moves `endsAt`, so the next
   period is announced again; a number already announced is not repeated, however often the timer runs or however
   many API processes run it.
2. **A timer finds them**, like `LineSnapshotsService` (at start and every hour, off under tests and without a
   database): `lines/expiry-notices.service.ts` `announce(now)`. Reading a list never writes (rule 4.10).
3. **Channels behind one port.** The timer hands the newly expiring numbers of each point of sale to
   `ExpiryChannel[]`. Today one channel: the in-app notice. An SMS channel is a second class added later, with
   no change to the timer, the marker or the notice. The mark and the in-app notices are written in one
   transaction per point of sale.
4. **The in-app notice** is kind `line.expiring`, new group `numbers`, link `/numbers?status=expiring`, payload
   `{ count, days, msisdns }` (`msisdns` holds the first three). One notice per point of sale per run, not one per
   number: fifty numbers ending on one day are one line in the bell, worded "3 numbers end within 3 days:
   059…, 059…, 059…" / "50 numbers end within 3 days".

## Decisions for the owner

- **D1 — who hears.** Proposed: the point of sale that owns the number, because it is the one that renews.
  Its parents keep the count on their home and the filter. Alternative: the whole chain up to the main agent.
- **D2 — one notice per point of sale per run** (proposed), or one notice per number.
- **D3 — the future SMS goes to whom**: the point of sale's own phone, or the subscriber's number itself. Not
  built now; the answer only decides what the per-number event must carry (it already carries the number and its
  point of sale, so either works).

## Non-goals

- Sending any SMS, WhatsApp or email. Choosing a gateway.
- A second notice on the last day, or after the number ended.
- Changing `EXPIRING_DAYS` or making it a setting.

## Risks

- First run after deploy: every number already inside the window is announced at once (one notice per point of
  sale). Intended.
- A number renewed onto another period inside the window is announced again for the new end date only when that
  date enters the window.
