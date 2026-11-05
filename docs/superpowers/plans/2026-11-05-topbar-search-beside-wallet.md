# Plan: topbar search beside the wallet

Spec: `docs/superpowers/specs/2026-11-05-topbar-search-beside-wallet.md`

1. Move `<ShellSearch />` out of `.topbar-start` and render it as the first child of `.topbar-tools`, before `.wallet-chip`.
   Files: `apps/web/components/office-shell.tsx`.
2. Match the field to the tools row: `.shell-search-field` height 2.5rem (2.75rem under 767px) and the wallet corner radius; keep `.shell-search` at `flex: 0 1 16rem`.
   Files: `apps/web/app/styles/shell.css`.
3. Verify in the browser: Arabic and English, light and dark, wide (about 1440px) and narrow (icon toggle under 720px of topbar width). Typecheck.
