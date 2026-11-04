# First paint matches the saved language

## Goal

A refresh in English, Hebrew, or dark mode paints that choice on the first byte. No frame of Arabic or light mode before it.

## Cause

`app/layout.tsx` always sends `lang="ar"` and `dir="rtl"`. `usePrefs` keeps the server snapshot on Arabic and light until the client mounts, then reads `localStorage`. The head script can flip `dir` and `.dark`, but the words are already in the HTML. Every page does this, because every page is rendered inside that layout.

## Decisions

- The saved language and theme live in cookies (`smilesim-locale`, `smilesim-theme`) as well as `localStorage`. The root layout reads the cookies and sets `lang`, `dir`, the `.dark` class, and the dictionary for that response.
- `usePrefs` uses that same server value as its snapshot. It does not force Arabic until mount.
- Changing the language or theme writes the cookie immediately, so the next refresh matches.
- If an older visit has only `localStorage`, the head script copies it into the cookies and reloads once, before the body is shown. A session flag stops a second reload.

## Non-goals

- No change to the login layout, copy, or theme tokens.
- No blank screen while waiting for JavaScript.
