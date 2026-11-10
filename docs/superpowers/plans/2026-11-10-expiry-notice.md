# Notice before a subscription ends — plan

Spec: `docs/superpowers/specs/2026-11-10-expiry-notice.md`. Starts after the owner answers D1–D3. One slice = one
commit on local `main`, ticked with its hash. Per slice: `npm run lint`, `npm run typecheck`, the touched specs,
`architecture.spec.ts`; the web slice is checked on the running copy (port 3000), ar and en, light and dark.

- [ ] **E.1 The marker.** `prisma/schema.prisma` `Line.expiryNoticedFor DateTime?`; migration
  `…_line_expiry_noticed_for` (a nullable column, no backfill). `rules/office-paging.ts`
  `unannouncedExpiringWhere(now)`: `expiringWhere(now)` and (`expiryNoticedFor` null or not equal to `endsAt`).
  Spec beside the existing paging spec.
- [ ] **E.2 The kind.** `notices/notice-kinds.ts`: `ExpiryNoticePayload { count, days, msisdns }`, kind
  `line.expiring`, group `numbers` (`NOTICE_GROUPS`, `noticeGroupOf`), `hrefFor` → `/numbers?status=expiring`.
  `notices.schemas.ts` group filter accepts `numbers`. `response-shape.spec.ts` and
  `query-filters.http.spec.ts` follow.
- [ ] **E.3 The timer and the port.** `lines/expiry-channel.ts`: `ExpiryChannel.announce(tx, pos, lines)` and
  `InAppExpiryChannel` (calls `NoticeService.write`). `lines/expiry-notices.service.ts`: `announce(now)` reads the
  unannounced expiring numbers grouped by point of sale (repository method, bounded by `LIST_CAP` per run), and
  per point of sale in one `runTx`: marks the numbers, calls each channel. Timer like `LineSnapshotsService`.
  Recipients per D1. Specs: two runs announce once; a renewal is announced again; a frozen account's point of
  sale is skipped; `get-writes-nothing.http.spec.ts` stays green.
- [ ] **E.4 Web.** `lib/api-types.ts` notice kind and payload; `lib/notice-text.ts` wording for one, few and
  many numbers; copy keys in `ar.ts`, `en.ts`, `he.ts`; the notices screen's group filter gains «الأرقام»;
  Playwright mock and a case in the notices test. `npm run check:copy`.
- [ ] **E.5 Docs.** `docs/architecture/backend.md` (lines row, notices row, the timer), `frontend.md` notice
  kinds, `docs/project-plan.md` dated line, `2026-11-10-open-items.md` ticked.
