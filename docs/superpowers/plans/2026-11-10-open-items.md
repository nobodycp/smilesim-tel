# Open items carried from the removed plans

On 2026-11-10 thirteen old plans were removed because the code had passed them (login, inner desk, companies and
packages, the three Pearl rebuild phases, the hotspot-store reflector, task ticket, eSIM serial and QR, site
branding, transfers and line prices, agent gates, remaining sections). Every task in them was checked against the
code: done, or replaced by a later design (Graphite identity, ADR 0003, ADR 0008, the kernel split). They stay in
git history. What follows is the only work or decision they still described.

## Waiting for an owner decision (`docs/project-plan.md` «مفتوح»)

- [ ] **Branch direct-sale price floor** when two main agents' prices differ (the 40 / 25 / 30 example,
  project-plan 2026-10-24). Today `floorFor` (`rules/user-terms.ts`) takes the floor from the account's own parent
  path; nothing chooses between the three options.
- [ ] **Disconnect grace days.** Mentioned in the explanation, never agreed, not in the code.
  (`Package.suspendAfterDays` is a different rule.)
- [ ] **Switch to a hidden package.** The companies-and-packages plan said a package that is not for sale stays a
  valid switch target when it is on the switch list; the code refuses it with `PACKAGE_HIDDEN`
  (`rules/user-terms.ts` `visibleTo`, used in `lines/lines.service.ts`). Keep the code's rule or the plan's.
- [ ] **A provider named «سكاي» in the seed** (`catalog/office-catalog.ts`, code `sky`), although the plan's rule
  says «سكاي» is a company, not a provider.

## Not built (later modules, each needs its own spec)

- [ ] Notice before a subscription ends. The "expiring" status and filter exist (3 days or fewer); no notice is
  sent.
- [ ] Refresh link for a number (the refresh operation itself exists).
- [ ] Message management; WhatsApp / email notices (project-plan: future, not now).

## Small gap

- [ ] `branding.http.spec.ts` has no case for `PUT /branding` from an entered (impersonation) session; the service
  refuses it (`branding.service.ts` `assertOwner`).
