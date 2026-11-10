# Open items

What the removed plans still described (2026-11-10), after the owner's answers of the same day. The plans
themselves were removed because the code had passed them: every task was checked against the code and found done
or replaced by a later design. They stay in git history.

## Waiting for an owner decision (`docs/project-plan.md` «مفتوح»)

- [ ] **Activation through a provider: the owner's word for each slice after S.1**
  (plan `2026-11-10-activation-settlement.md`, ADR 0019 accepted). S.1–S.4 and S.5a are built; S.5b (seal on write, backfill) is next. S.4 left two
  points for the owner's separate review: a plain activation stores no provider cost on its entry, and a renewal
  task no `unitPrice`. (A switch is re-quoted at completion on purpose and is now settled against its hold.) Before deploying S.2 anywhere: `npm run reservation-conflicts --workspace api`.
- [ ] **Branch direct-sale price floor** when two main agents' prices differ (the 40 / 25 / 30 example,
  project-plan 2026-10-24). Today `floorFor` (`rules/user-terms.ts`) takes the floor from the account's own parent
  path; nothing chooses between the three options.
- [ ] **Disconnect grace days.** Mentioned in the explanation, never agreed, not in the code.
  (`Package.suspendAfterDays` is a different rule.)
- [ ] **Switch to a hidden package.** The old companies-and-packages plan said a package that is not for sale
  stays a valid switch target when it is on the switch list; the code refuses it with `PACKAGE_HIDDEN`
  (`rules/user-terms.ts` `visibleTo`, used in `lines/lines.service.ts`). Keep the code's rule or the plan's.

## In work

- [ ] **Notice before a subscription ends**, built so an SMS can follow later:
  `docs/superpowers/{specs,plans}/2026-11-10-expiry-notice.md` (waits for the owner's word on its three
  decisions).

## Future features (owner, 2026-11-10: after the current work; each needs its own spec)

- [ ] **Refresh link for a number.** The refresh operation exists; the link carries many rules of its own and is
  postponed.
- [ ] **Message management; WhatsApp and email notices.**

## Settled on 2026-11-10

- «سكاي» is both a provider and a network (a company) of the same name: the seed is right as it is.
- `PUT /branding` from an entered session: covered by `branding.http.spec.ts`.
- `session-and-secret-storage` T.3, T.5 and S.7: done (see that plan).
