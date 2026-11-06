# Page tab title

**Date:** 2026-11-07
**Status:** approved

## Goal

The browser tab names the section the user is in: `الأرقام · سمايل سيم`, `Numbers · Smile sim`.
Today every page shows the site name alone; the only change to the title is the unread count
`useUnreadTitle` prefixes.

## Decisions

- The `<title>` is a React element, not `document.title`. React 19 hoists a `<title>` rendered
  anywhere into `<head>` and keeps it updated. Writing `document.title` from an effect lost a
  race with the metadata title Next re-applies on every client navigation.
- `generateMetadata` in the root layout no longer sets `title` (it keeps the icon). There is one
  `<title>` per surface: `OfficeShell` renders `(n) <page> · <brand>` (or `<brand>` alone);
  `OfficeFrame` renders `<brand>` on auth paths; the layout renders `<brand>` on the doors page.
- `lib/page-title.ts` is a small store: `usePageTitle(title)` announces the section from the
  page (effect, with an owner token so an old page cleaning up after the new one mounted does
  not clear it); `usePageTitleValue()` reads it in the shell; `tabTitle()` composes the string.
  `useUnreadTitle` is gone; the unread count is part of the composed title.
- `Desk` announces its `title` when it is a string; a `ReactNode` title or an empty string
  leaves the brand alone. The home page and the settings page announce their own headings.
- The separator is ` · ` (middle dot), the same mark the UI already uses between two names.
- The brand comes from `useBranding().name`, so a saved site name shows in the tab.

## Non-goals

- No per-route `metadata` exports; the pages are client components.
- The server-rendered title is the brand alone; the section joins on the client, as before.
