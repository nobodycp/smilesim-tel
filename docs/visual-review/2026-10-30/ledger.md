# Internal UI ledger — 2026-10-30

Status words: `code` means the shared pattern is in the source. `seen` means this session opened it in the browser. Inheriting CSS is not `seen`.

| Surface | Depends on | Defect | Reconstruction | Code | Seen |
| --- | --- | --- | --- | --- | --- |
| Users table | `.data`, `.fit`, `.num`, `RowMenu` | Equal columns, mixed alignment | Name flexes; layer, parent, status shrink; money at end | yes | ar, innerWidth 1280: name 561 start, money ~60 end, headers match cells |
| Users menu | `RowMenu` | All ops were one dialog | One item opens one dialog | yes | ar earlier; not reopened this pass |
| Users create | `Dialog` form | Save stayed enabled when empty | Save waits for login, name, password, and a role for staff | yes | ar 390 full dialog, save disabled. 960 capture clipped the title |
| Users fund / ceiling / transfer / password / freeze / enter / delete | `Dialog` | One crowded dialog | Separate dialogs, confirm size for freeze, enter, delete | yes | fund and transfer, ar |
| Roles dialog | `Dialog`, `.perm-grid`, `label.check` | Name and checks shared one grid | Name row, then permission grid | yes | ar/en/he at 390, one column, 16px checks. At 1280 measured two columns, dialog 600px. Footer cropped in the narrow shots; measured on screen |
| Numbers list + activate | workbench, `RowMenu`, `Dialog` | Empty trial list | Same table system | yes | not opened with rows |
| Number detail tabs | `.command-list`, `.steps` | Big action cards | Row actions plus one form per change | yes | blocked: no lines |
| Tasks | workbench, `RowMenu` | Reason field still sits in the note cell | Menu exists; reason is not its own dialog | partial | not seen |
| Operations, accounting, audit, reports, home log | `latinWhen`, `.when`, `.num` | Arabic dates reordered | Latin timestamp inside `bdi` | yes | not seen |
| Packages, providers, settings, wallets, ledger, plans, staff, login | mixed | Not rebuilt this pass | Keep shell; inner pages still on older cards where noted | no | not seen |

Shared pieces in use: `Dialog` (`components/dialog.tsx`), `RowMenu` (`components/row-menu.tsx`), `Desk` / `Money` / `latinWhen` (`components/desk.tsx`), workbench rule `.desk > .filter-bar + .pane`, table classes `.num` `.fit` `.when` `.row-actions`.

Blocked: number detail and number row menus. Trial seed is four accounts only (`trial-seed.ts`). Activation writes a local line only when the package is automatic, and it debits the point-of-sale wallet. Not run.
