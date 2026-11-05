# Site identity: settings group in the sidebar and a branding page

Goal: the branch owner can give the office its own name, tagline, logo, and browser-tab icon from one page, the same way account manager's "Site branding" page (`/management/branding/`) does. The sidebar's Admin section gets a collapsible "Settings" group, and "Site identity" is its first entry. What is saved shows on the sidebar brand block, the sign-in page, the auth frame, the door picker, the browser tab title, and the favicon.

Today the brand is a fixed string per locale (`t.brand`, `t.brandSub`), a fixed `Wifi` glyph in the sidebar, and a fixed `app/icon.svg`.

## Decisions

### Data

- One row, `SiteBranding`, `id Int @id @default(1)`:
  - `siteName String @default("")`: empty means the per-locale default `t.brand`.
  - `tagline String @default("")`: empty means the per-locale default `t.brandSub`.
  - `logo String?`: a `data:image/(png|webp);base64,...` URL, the uploaded logo shrunk by the browser to at most 768px on its longest side. Same storage as `Company.image`.
  - `logoDark String?`: the dark-theme copy of `logo`, built by the browser at upload time (see "Dark logo"). Present whenever `logo` is.
  - `favicon String?`: a square data URL, at most 256px.
  - `updatedAt DateTime @updatedAt`: its millisecond value is the cache-busting `version`.
- The row is global, not per door: the four doors are one business.
- Limits enforced by the server: `siteName` at most 120 characters, `tagline` at most 160, each image at most 300 000 bytes decoded, PNG or WebP only. Otherwise `INVALID`. No new error code.

### Dark logo

The reference builds a dark copy of the logo so black lettering reads on the dark theme. Here the browser does it before upload, in `lib/branding-image.ts`, with the same rule as `dark_logo_variant`: for every opaque pixel where `chroma < 0.3 * high` or (`high < 50` and `chroma < 18`), set `r = g = b = min(255, 150 + mean(r, g, b) * 0.42)`; leave coloured pixels and alpha unchanged. The result is uploaded as `logoDark`. The server stores both and never derives.

### API

New module `apps/api/src/modules/branding/`, registered in `registry.ts`.

- `GET /branding` (public, no session): `{ siteName, tagline, hasLogo, hasFavicon, version }` where `version` is `updatedAt` in milliseconds, or `0` when the row does not exist. Never fails on a missing row.
- `GET /branding/logo`, `GET /branding/logo-dark`, `GET /branding/favicon` (public): the decoded image bytes with its `Content-Type` and `Cache-Control: public, max-age=31536000, immutable`. `404 NOT_FOUND` when unset. Callers append `?v=<version>`.
- `PUT /branding`: body `{ siteName: string; tagline: string; logo: string | null; logoDark: string | null; favicon: string | null }`. The branch door, a full session, the branch owner, not impersonating; otherwise `403 FORBIDDEN`. `null` clears the image. Returns the same shape as `GET /branding`. Recorded in the activity log as `site_branding`.
- The JSON body limit of the API rises to 1 MB (`main.ts`); today's default is 100 KB, which a 768px logo plus its dark copy can exceed.
- Validation and the data-URL decode live in a pure `branding-rules.ts` with unit tests. Persistence sits behind a `BrandingStore` (`Prisma` and `Memory`), the pattern `AUTH_STORE` uses, so the HTTP tests run without a database.

### Web: where the brand shows

A `BrandingProvider` (`lib/branding.tsx`) wraps the app in `layout.tsx`. The layout loads `GET /branding` on the server with a 1500 ms timeout and falls back to defaults when the API is unreachable, so a broken API never blanks the office. `useBranding()` returns `{ name, tagline, logo, logoDark, favicon, version }` already resolved against the locale defaults (`logo`, `logoDark`, and `favicon` are same-origin URLs `/api/branding/...?v=version`, or `''`).

- Browser tab: `generateMetadata` sets `title` to the saved name and `icons.icon` to the favicon URL when one is saved; otherwise today's `app/icon.svg`.
- Sidebar brand block: with a logo, an `<img>` replaces the ink tile (light copy by default, dark copy under `.dark`); the name is the saved name; the second line stays the door label, because the four doors need telling apart. Without a logo the tile and `Wifi` glyph stay.
- Sign-in page lockup: the saved name and tagline. With a logo, the image sits above the name. The banner is an ink panel, so it shows the dark copy on the light theme and the light copy on the dark theme.
- Auth frame (`/password`, `/two-factor`): logo (if any) replaces the SIM mark; name and tagline.
- Door picker (bare host): saved name only.
- The document `<html>` keeps `lang`, `dir`, and `.dark` as today; images swap with CSS (`.dark .brand-logo-light { display: none }`), not with script.

After a save the page calls `router.refresh()` so the layout reloads the row and the shell repaints.

### Sidebar: collapsible Settings group

- In the office nav, the Admin section becomes: Audit, Roles, then a group "Settings" (`Settings` icon) that opens and closes on click. Its first entry is "Site identity" (`Palette` icon), `href: /branding`, `layers: ['branch']`, `owner: true`.
- The group is open when one of its entries is active, otherwise it starts closed. Clicking the header toggles it; the state is `aria-expanded` on the header button. No persistence and no height animation (DESIGN.md allows motion only on the sidebar width, drawer, bell, spinner, shimmer).
- The header is a `.nav-link`-sized button with the icon, the label, and a chevron at the inline end that points down when open. Its children are `.nav-link`s indented by the icon width so the group reads as one block.
- In the collapsed (icon-only) sidebar the header is not drawn; the children show as icon links like every other item, so nothing is lost.
- A group whose entries are all filtered out (layer, owner) is not drawn.
- `roots` (used by the back link) include the group's hrefs.

### Branding page `/branding`

Route guard: `useRequireLayer(['branch'])` plus `me.isBranchOwner`; a non-owner is sent home like `/roles`.

Composition (`.desk` → page head → `.brand-layout`, canvas scrolls):

- `.page-head`: "Site identity" and one lede: "The name, logo and tab icon everyone sees on the sign-in page and in the office."
- `.brand-layout`: two columns above 960px (form 1fr, preview 360px fixed), one column below. Fills the width given.
- Form column, one `<form>`:
  - Pane "Name and tagline": `siteName` and `tagline` text fields side by side on wide screens (`.pair`), each with its locale default as `placeholder`.
  - Pane "Images": two drop fields in a row that wraps: "Sign-in logo" (wide, 3:1 box) and "Browser tab icon" (square box). A drop field is a `<label>` wrapping a hidden `<input type="file" accept="image/png,image/webp">` with the current image or an upload glyph, the text "Choose an image" / "Replace image" and "or drag it here", and under it a "Remove image" secondary button when one is set. Drag-and-drop uses `onDrop` on the label. A file over the limit after shrinking shows the error banner `brandingTooLarge` and keeps the old image.
  - Foot: one primary "Save changes" button (disabled until something changed) and one secondary "Discard" that restores the loaded values. Success shows the note banner "Identity saved"; failure shows the error banner with the API text.
- Preview column `aside.brand-preview` (the one memorable element of the page; everything else is quiet): a browser-tab mock (favicon + name), a sidebar mock (logo or initial, name, tagline), and a sign-in mock (logo, name, two field bars, a button bar). It reads the current draft, including unsaved uploads, so the person sees the change before saving. On the dark theme it uses the dark logo copy. Below 960px the preview sits under the form.

Copy keys added in `ar.ts`, `en.ts`, `he.ts`: `navSettings`, `navBranding`, `brandingTitle`, `brandingLede`, `brandingNames`, `brandingSiteName`, `brandingTagline`, `brandingImages`, `brandingImagesHint`, `brandingLogo`, `brandingFavicon`, `brandingChoose`, `brandingReplace`, `brandingDrag`, `brandingRemove`, `brandingPreview`, `brandingPreviewTab`, `brandingPreviewSidebar`, `brandingPreviewLogin`, `brandingSaved`, `brandingTooLarge`, `saveChanges`, `discardChanges`.

### Styles

- Shell group: `.nav-group`, `.nav-group-head`, `.nav-group-chevron`, `.nav-group-body` in `shell.css`; the logo image in the brand block is `.brand-logo` (`.brand-logo-light` / `.brand-logo-dark`) in `base.css` next to `.brand-mark`, since auth and shell both use it.
- Page: `.brand-layout`, `.brand-drops`, `.drop-field`, `.drop-field.square`, `.brand-preview` and its mocks in `desk.css` under the page compositions. Tokens only; no new token is expected. The preview mocks reuse `--rd-surface-2`, `--rd-line`, `--rd-primary-bg`.
- Sign-in: `.login-logo` sizes in `auth.css`.

## Non-goals

- Per-door or per-locale branding.
- Colour theming (accent, primary) from the page.
- Server-side image processing; the browser shrinks and derives.
- A letterhead or invoice logo.
- A "system settings" page; the Settings group holds one entry today and is built to take more.
