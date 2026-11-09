# Plan: offers hero, task notes and statuses, add-ons, wallet page, eSIM per package

Spec: `docs/superpowers/specs/2026-11-09-offers-tasks-addons-wallet-esim.md`. One slice at a time; each ends with the CI steps, Docker in ar/en light/dark and desktop/mobile, codemaps, and a commit.

## Slice 5: eSIM per package — done 2026-11-09
- [x] Migration `Package.esimAvailable`; packages sheet and details setter; activation check reuses `ESIM_UNSUPPORTED`.
- [x] Details form switch; the activation dialog hides eSIM when not allowed.

## Slice 4: wallet page — done 2026-11-09
- [x] `/wallet` route and screen (cards, chart, own movements, top-up «قريباً»); topbar chip → link with «المحفظة».

## Slice 2: task notes and statuses — done 2026-11-09
- [x] Migration: `OfficeTaskNote.internal`, `pending` → `working`; open tasks as `working`; complete/reject by any handler; internal notes hidden from non-branch readers and notices.
- [x] Web: status words, no take step, internal note checkbox and badge.

## Slice 3: line add-ons
- [ ] Migration `PackageAddon`; CRUD under the package; `POST lines/:id/addon` opens the task with hold; completion moves the price.
- [ ] Web: package tab, line card menu, names in task, history, finance.

## Slice 1: offers hero
- [ ] Migration `Offer`; CRUD and `GET offers/live`; route table and permission matrix.
- [ ] Web: `/offers` admin page, `OfferHero` on the home (timer per offer, dots, arrows, swipe, keys, pause, reduced motion), styles, copy.
