# Persistent office shell

**Date:** 2026-11-07
**Status:** approved

## Goal

The sidebar and topbar are mounted once per tab and survive client-side navigation. Moving
between sections replaces only the page inside `.canvas`; the logo, icons, greeting, wallet
chip, notice bell, collapsed state, and open nav groups stay exactly where they were.

## Observed

`OfficeShell` is rendered inside every page (`Desk`, `app/page.tsx`, `app/settings/page.tsx`).
When the route changes, React replaces the old page tree with the new one and the shell is part
of it, so `.sidebar` and `.topbar` are destroyed and recreated on every navigation. Measured in
the browser: 100ms after a sidebar click the `.sidebar` and `.topbar` DOM nodes are new objects.
Visible effects: the logo and icons flash, the greeting is empty until the clock effect runs,
`collapsed` resets to `false` then snaps to the saved value, open nav groups close, the notice
list is fetched again and the notice stream reconnects. It reads as a full page refresh even
though the document never reloads.

## Decisions

- A client `OfficeFrame` component sits in `app/layout.tsx` inside `OfficeSession`. It reads
  the pathname: auth paths (`/login`, `/password`, `/two-factor/*`) render their children bare;
  every other path renders them inside one `OfficeShell`.
- `authPath` moves out of `office-session.tsx` as an export so the frame and the session agree.
- `OfficeShell` loses the `account`, `hint`, and `wide` props. The shell already holds `me`, the
  saved identity, and `initialName`; it derives the shown name itself with the same precedence
  `Desk` used (`me.nickname || me.loginName`, else the saved account, else the cookie name). The
  canvas is always `canvas-inner wide`; every caller passed `wide`.
- `Desk`, `app/page.tsx`, and `app/settings/page.tsx` drop their `OfficeShell` wrapper and
  return their page content only.
- `OfficeSession` exposes `refresh()` that re-reads `/office/me` into `me`. The settings page
  calls it after a successful profile save so the topbar name follows the edit, which it did
  before through the `account` prop.
- The shell keeps `failed` → `OutagePanel`, `OutageBar`, and `BackLink`. The skeleton-until-ready
  gate moves into `Desk`, the home page, and the settings page. The shell renders its children
  at once, so the page component mounts on the first render and its loads start beside
  `/office/me`, as before. Mounting the page only after `ready` would make every page load wait
  for the session and, in development, let Strict Mode fire each load effect twice on the
  late mount (the e2e layer-guard test caught the doubled `GET /providers`).

## Non-goals

- No route-group move of the page directories. The frame decides by pathname so the file tree
  stays as it is.
- No change to the "not ready" nav group or to nav items.
- No change to page-level `.desk` / `.page-head` markup.
- No restyle of the shell.

## Verification

- Browser: set a marker on `window`, navigate through five sidebar sections; the marker and the
  `.sidebar` / `.topbar` DOM nodes are the same objects throughout. Collapse the sidebar, open a
  nav group, navigate: both stay. Login page still renders without the shell.
- Settings: save a new full name; the topbar name updates without a reload.
- `npm run lint`, `npm run check:copy`, `npm run typecheck`, `npm run test:api`, `npm run build`,
  Playwright e2e.
