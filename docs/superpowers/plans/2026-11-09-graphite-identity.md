# Plan — Graphite identity and home layout

Spec: `docs/superpowers/specs/2026-11-09-graphite-identity.md`. One verified slice at a time; each ends with the gate,
screenshots (ar/en, light/dark, desktop/phone) and a commit.

- [ ] **G1 — Tokens and type.** `tokens.css` values → Graphite (both themes), radii scale tightened, Noto Kufi Arabic in
  `layout.tsx`, dark as the default theme (`document-prefs`, `prefs`, the one e2e that assumes light). `DESIGN.md`
  Identity, Tokens, Type rewritten.
- [ ] **G2 — Shell.** Sidebar look and edge handle (`[`), path in the topbar (`components/crumbs.tsx` → `ShellPath`,
  `Alt+↑`), greeting moved out, back link and in-canvas trail removed, search as a command box. `frontend.md` updated.
- [ ] **G3 — Home.** New arrangement in `home-screen.tsx` and `features/desk/overview.tsx` (figure band with sparkline,
  middle row with shortcut tiles, rankings row), cut corners and motion in `desk/home.css` and `base.css`.
- [ ] **G4 — Shared components.** Zebra table rows and head, tabs, buttons, inputs, badges, panes and dialogs on the new
  tokens; motion on inner-page card grids.
