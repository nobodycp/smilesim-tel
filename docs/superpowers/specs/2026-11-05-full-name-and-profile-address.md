# Full name, account labels, and profile address

## Goal

The field that was called "nickname" is the account's full name. Wherever the office shows or searches an account, it shows the login name with the full name in parentheses, `login (Full Name)`. The profile gains a city (a Palestinian city list) and a free-text address.

## Decisions

### Full name

- The stored field stays `User.nickname` in Prisma and in the API JSON; renaming the column and ~40 call sites buys nothing the user can see. Every label, hint, and error message calls it the full name: Arabic "الاسم الكامل", English "Full name", Hebrew "שם מלא".
- The validation code `NICKNAME_INVALID` becomes `FULL_NAME_INVALID` with the message "الاسم الكامل من حرفين إلى أربعين حرفاً". Length rules do not change (2–40 characters).
- The create-account dialog, the profile, and all copy keys use the new wording. Copy keys are renamed (`fullName`, `savedFullName`); `saveNickname` is dropped because nothing reads it.

### Account label

- One component, `AccountName` in `apps/web/components/account-name.tsx`, renders an account reference: `<bdi dir="ltr">login</bdi>` followed by ` (full name)` in a muted span. When the full name is unknown or equals the login, only the login is shown. A text form, `accountLabel(login, name)`, serves `<option>` labels, `aria-label`s, and `RowMenu` labels.
- Names come from a directory the shell loads once per session: `GET /office/directory` answers `{ names: { [loginName]: fullName } }` for the accounts the actor can see (own subtree), the actor's ancestor chain, and every branch-layer account (staff appear as actors in ledgers). `OfficeSession` exposes it as `names`; `AccountName` reads it through `useOffice()`. A row that already carries the name (users list, offers) passes it explicitly and wins over the directory.
- Applied everywhere a login name is rendered as a reference to an account: users table (account cell and parent), account detail title and facts, numbers table and line card (point of sale), tasks table and task card (point of sale, submitter, assignee), reports (point of sale, account, actor), finance (account, actor), ledger and audit (actor), home movements (point of sale), provider operations (account, when shown), and the shell search hit label. Selects that pick an account (point of sale on activation and transfer, parent on create/transfer, package offers) use `accountLabel`.
- The signed-in identity card in the topbar menu and the identity block at the top of the profile keep "full name" on top and `@login` beneath: they describe the viewer, not a reference to another account, and both pieces are already present.
- Search: the shell search and the users page already match both the login and the full name; the hit now reads `login (Full Name)`.

### Profile: city and address

- `User.city String?` and `User.address String?` with one migration. Both optional, both saved from the profile without the current password (same class as the full name; email, phone, and password keep the password check).
- The city is a key from `PALESTINE_CITIES` (API `apps/api/src/modules/auth/cities.ts`); an unknown key fails with `CITY_INVALID`. An empty string clears it. The web keeps the same keys with Arabic, English, and Hebrew labels in `apps/web/lib/cities.ts` and sorts the select by the current language's label. The list covers Jerusalem, the West Bank governorate centres and larger towns, the Gaza Strip, and the main Arab cities inside the 1948 lines; trimming or extending it is a one-line change per city.
- The address is free text, trimmed, at most 120 characters, otherwise `ADDRESS_INVALID`.
- The profile page shows the city select and the address field in the account pane under the phone, each as a `.field-row` with its own save control, like the fields above them. `GET /auth/profile` and the `PATCH` answer carry `city` and `address`.

## Non-goals

- No rename of the `nickname` column or API field.
- No city or address on the users list, the account detail, or in reports; the profile is the only reader for now.
- Notice texts that name an account (`noticeAccount login`) keep the login only; their payloads are stored JSON and are out of this slice.
- No change to who can see which accounts; the directory follows the existing visibility rules.
