# The open design gaps after Phase 5

Date: 2026-11-08 · Status: done · Source: `DESIGN.md` → Known gaps

| Gap | Decision | Visible change |
|---|---|---|
| Key/value has three shapes (`.fact-grid`, `.detail-rows`, `.task-facts`) | Looking at them, the three serve three places (a summary head, a tile grid, a narrow rail); forcing one shape would make two screens worse. They become **one primitive**, `Facts`/`Fact` (`components/facts.tsx`), with three densities that keep today's markup. A new page picks a density instead of writing a `<dl>`. | None (byte-identical screenshots) |
| `.sidebar` animates `width` | The width snaps; the sidebar's children fade in after each toggle (an animation name per state restarts it). Transform and opacity only, as the motion rule says. | The collapse is instant with a 180 ms fade of the contents |
| Topbar below 390px not stress-tested | Measured at 320/360/390 in ar, en, he: at 320px the account menu sits 22 px off screen (seven 44 px controls + the menu button need ~350 px). Under 360px theme and language move to the drawer's foot; targets stay 44 px. | Only under 360px |
| Radius literals (16px / 12px "instead of `--rd-radius-lg`") | The 16 and 12 were already tokens (`panel`, `card`); what was missing was the rule. Rule written in DESIGN.md; the two in-page cards that broke it (`.company-card`, `.pack-card`) move to `lg`. The other literals map to steps (`99px`/`9999px` → pill, `18px` → lg, `14px` → new `tile`, `4px`/`2px` → new `2xs`, `0.7/0.6/0.35rem` → card/md/xs, under 1 px). | Company and package cards 16 → 18 px corners |
| Company-mark contrast | `markColor(name)` = `hsl(h 42% 33%)`: worst hue (60°) 4.67:1 against white, so the 13–14 px marks pass AA. Was 42% lightness, 3.04:1 at worst. | Marks are darker |

Checks: `tests/topbar-narrow.spec.ts`, `tests/company-mark.spec.ts` (every hue), screenshots before/after (light/dark, 1280/390) of home, numbers, users, packages (branch and pos), number card, settings, the user page and the task ticket.
