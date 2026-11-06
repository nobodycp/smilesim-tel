# Terms follow-ups and e2e repair — Design

**Date:** 2026-11-06
**Follows:** `2026-11-05-user-packages-and-operations-design.md` (shipped in `18224ac..90a0d67`)

## Goal

Close the items the whole-branch review of user packages and operations deferred, and bring the
Playwright job back to green so it can be trusted again.

## Decisions

### 1. Sell price reset

- New route `DELETE /office/sell-prices/:code`. Same gate as `PUT` (`main_agent` or `agent`, not
  impersonating). Deletes the actor's `SellPrice` row for that package; a missing row answers `ok`.
- `/packages` (agent and main agent): the «سعر البيع» cell gets a reset control next to «حفظ»,
  shown only when the row has an own sell price (`sellPrice !== null`). It uses the existing copy
  `resetDefault` («إرجاع للافتراضي») and the `undo` icon, as the package sheet does. After reset the
  two fields are empty and show the layer default as placeholder.
- Audit action `sell_price` is reused for the delete (payload `{ cleared: true }`).

### 2. Bulk write in one transaction

- `setUserPackagesBulk` loads the user's terms and sell rows once for the requested packages,
  then performs every write inside one `runTx`, so a floor or permission failure midway leaves
  nothing half-applied. The summary is computed from the in-memory rows after the loop.

### 3. Accounts loaded once per request

- `resolveBuyPrice` and `visibleFor` accept the already-loaded `accounts` (and `path` where the
  caller has it) instead of calling `this.accounts()` again. Callers in `activate`, `extend`,
  `switchPackage`, and `visibleSwitchTargets` pass what they hold. No behaviour change.

### 4. e2e repair

Each red test was checked against the current rules; the code is right in every case and the
test is stale or its mock too broad:

| Test | Cause | Fix |
|------|-------|-----|
| `desk.ts` `expectFullTable` h2 check | `getByRole` name is a substring match; «قائمة الأدوار» matches «الأدوار» | `exact: true` |
| `desk.ts` `expectFullTable` lede check | `content-ui` allows an optional `.lede`; users has one | drop the assertion from the helper (numbers keeps its own) |
| `lists-desk` provider page | `**/office/providers**` also answers the settings call with the list shape → `modes` undefined → client crash | mock `/office/providers/cell/settings` with a real `ProviderSettings` body and narrow the list route |
| `numbers-desk` | trigger label is «إجراءات <msisdn>», test still says «عمليات» | update the regex |
| `login` end session | the test flips `GET /auth/sessions` to 401 after the first call, but the shell also lists sessions, so the page's own list gets 401 before the row renders | flip to 401 only after the `DELETE` |
| `tools-pages:51` | every task row now has «فتح المهمة», so each row has a menu | expect 2 menus |
| `tools-pages:289` | `actionName('reactivate')` is «شحن» on purpose (reactivate is a charge on a disconnected line; the API maps it to the `charge` stop) | expect «شحن» |

## Non-goals

- No new colour tokens, no new components.
- `setById` surfacing, bulk confirm wording, and the `color-mix` track colour stay as they are.
- No change to how the package sheet or the user page reset prices.
