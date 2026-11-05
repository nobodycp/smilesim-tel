# Topbar search beside the wallet

## Goal

The office search field sits in the topbar tools cluster, directly beside the wallet chip, instead of trailing the greeting on the start side.

## Decisions

- `ShellSearch` moves from `.topbar-start` to the first position in `.topbar-tools`, so in RTL it is the control nearest the greeting and touches the wallet chip; in LTR the order mirrors.
- The field takes the tools row height (2.5rem, 2.75rem on touch) and the same corner as the wallet chip, so the two read as one row of controls.
- The greeting keeps the start side alone and may use the freed width.
- Collapse rules do not change: under 720px of topbar width (container query) and under 768px (touch) the field is still the icon toggle that opens a floating box aligned to the tools end.

## Non-goals

- No change to search behaviour, results, or the `/` shortcut.
- No new tokens or classes beyond scoping the field height.
