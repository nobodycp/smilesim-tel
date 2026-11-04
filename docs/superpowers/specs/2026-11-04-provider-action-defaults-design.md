# Provider action defaults (Provider settings)

## Goal

Each provider carries default run modes for line operations. New packages under that provider copy those defaults once, then keep independent package settings. The provider page is a settings surface (extensible), not packages-only.

## Decisions

### Storage

- Add a flexible JSON map on `Provider` (e.g. `actionModes`): action key → mode (`auto` | `manual` | `off`).
- Do **not** mirror Package’s fixed `auto*` / `allow*` columns onto Provider. A map stays open for new operations and per-provider support later.
- Catalog of actions lives in code (same eight as the package run tab today). Adding an action later means extending the catalog; existing provider maps get a safe default for the new key when read (missing key → `manual`). Existing packages are never rewritten.

### Cascade

- Saving provider defaults updates **only** the provider row.
- Existing packages are never bulk-updated from provider settings.
- When a package is **created**, copy provider modes into that package’s `auto*` / `allow*` flags once. After that the package is fully independent (package sheet run tab unchanged).
- There is no reverse sync from package → provider.

### Modes and labels

- Modes stay: `auto` (مباشر / automatic), `manual` (مهمة فرع), `off` (متوقف).
- UI action labels match the package run tab (activate, charge, extend, disconnect, freeze, switch, rename → تحديث الرقم, sim → تبديل الشريحة). No alternate naming.

### Initial values

- Migration / empty map: every catalog action defaults to `manual` when resolved for UI or for package create.
- No migration of existing package flags.

### Provider page

- Route `/providers/[code]` gains two tabs: **Provider settings** | **Packages**.
- Settings tab today: one block — run modes table (same control pattern as package run tab). Save per action (or equivalent) to the provider only.
- Same tab is the home for future provider-only settings (connectivity, limits, supported operations). Supported-ops UI is **out of this slice**; storage shape must not block it.
- Packages tab: current package table unchanged.

### API

- Branch layer only (same gate as today’s provider/package office screens).
- Read provider settings (code, name, modes map).
- Update one action mode (same `action` + `mode` shape as `setPackageMode`) without touching packages.
- Shared helpers: normalize modes map; convert modes → package boolean flags for create-time copy.

## Non-goals (this slice)

- Per-provider “supported operations” on/off UI.
- Bulk overwrite of existing packages.
- Changing package sheet behaviour or mode vocabulary.
- Creating a new package-create UI if none exists yet — only the copy helper and a clear call site when create exists; if create is only via seed/import scripts, wire the helper there or leave a tested helper for the next create path.
- Money, task routing, or operation execution changes.

## Success

- Branch can open a provider, set defaults, and see them persist.
- Changing defaults does not change existing package modes.
- New package creation (when that path runs) receives a one-time copy of provider modes.
- ar / en / he copy and light / dark themes work on the new settings tab; layout fills width per office rules.
