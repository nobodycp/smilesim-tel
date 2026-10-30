# Visual coverage — 2026-10-30

Reviewer: independent agent `56593674-da74-4c7e-a95c-ff90e5027ffa`. Locale after the pass: Arabic. App: `http://admin.localhost:3000`.

| Page / operation | Locale / viewport | Evidence | Implementer | Reviewer | Remaining |
| --- | --- | --- | --- | --- | --- |
| Roles → role dialog (before) | ar, desktop | `before-role-dialog.jpg` | Defect: mixed grid, oversized checks | — | Starting point |
| Roles → role dialog | ar, desktop | `after-role-dialog-ar.png` | Header, name row, two-column permissions, footer | Structure accepted on the later narrow pass | — |
| Roles → role dialog | ar, 390px | `review2-role-narrow.png` | One column, 16px checks, 16px side gaps | Passed structure; footer was cropped in the image and measured on screen (bottom 676 / height 800) | Footer not in the screenshot |
| Roles → role dialog | en, he, desktop | `after-role-dialog-en.png`, `after-role-dialog-he.png` | Same dialog, translated labels | Captured before the 44px close control | Close size not re-shot in en/he |
| Users table | ar, desktop | `review2-users-table.png` | `row-actions`, numeric ceiling/balance at the end, 44px triggers | Passed | — |
| Users → account dialog | ar, desktop | `review2-account-dialog.png` | Section headings, footer delete separated | Passed | — |
| Users → create account | — | Not opened | Same `Dialog` shell in source | Not reviewed | Unverified |
| Settings → end session menu | ar, desktop | `review2-row-menu.png` | Menu opens inward from the trigger | Passed placement and contents | — |
| Settings → session line | ar, desktop | `review3-session-meta.png` | `::1 · 2026-10-30 15:17`, LTR isolate, aligned under the name | Approved | — |
| Numbers → row menu / activate | ar | Empty trial list (`لا أرقام بعد`) | `RowMenu` and activate footer in source | Not opened | Blocked: no lines |
| Tasks, packages, provider offers, reports | — | Source only | `row-actions` / `num` / `RowMenu` migrated | Not screenshotted | Unverified live |
