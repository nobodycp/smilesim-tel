# Line operations

One office catalog decides which operation a line may run. Provider settings are the template for a new package. After that copy, the package mode map is independent. Screens that start an operation ask one function. The catalog does not call an outside provider; a mode only chooses an immediate result or a branch task.

This extends `2026-11-04-provider-action-defaults-design.md`. That spec keeps provider modes in a JSON map and copies them into package boolean flags once. This spec adds the operation catalog, package mode map, and the run rules. It does not reopen provider-page layout.

## Catalog

Each operation has one key. A package mode is `auto`, `manual`, or `off`.

| Key | Shown when | Inputs |
|---|---|---|
| `activate` | A new physical SIM or eSIM is entering for the first time. Not on an existing line. | The office generates the line number. A physical SIM also needs its serial. An eSIM does not. Neod also asks for one text value, the current number details, and the SIM serial. Tokman asks for the number and the SIM serial. Those two forms apply only to a new activation. |
| `charge` | The line exists and its status is `disconnected`. | None beyond the line. |
| `extend` | The line is `active` and `endsAt` is still in the future. | None beyond the line. |
| `switch` | The line is `active`. | The target package. |
| `disconnect` | The line is `active`. | None. Settlement stays the disconnect-refund spec. |
| `sim` | The line is `active`. | The new serial. |
| `freeze` | The line is `active`. | None. |
| `unfreeze` | The line is `frozen`. | None. Uses the `freeze` mode. There is no separate unfreeze switch. |
| `rename` | The line is `active`. | The new number, as the customer requested. |
| `companySwitch` | Not shown. The key is stored so a provider or package can set it. | None until a later spec defines them. A run request is rejected. |

A stopped operation is absent from the numbers list, the number page, and the activation dialog. Finance and provider-operation history keep showing what already happened. They do not decide what is allowed now.

Extra jobs, such as added gigabytes, are not in this catalog.

## Modes

The provider keeps `actionModes`: action key to `auto`, `manual`, or `off`. Saving the provider writes that row only.

A new package copies that map once into its own `actionModes` map. Changing the provider later does not change the package. Changing the package does not change the provider. Existing packages are not rewritten from the provider.

For a key that already has `auto*` / `allow*` columns, a package save writes the map and those columns together. Readers use one resolver: the package map when the key is present, otherwise the existing boolean pair, otherwise `manual`. `companySwitch` lives only in the map. A missing key still resolves to `manual`, and `companySwitch` stays off the run screens because the operation has no fields.

Mode meaning:

- `off`: the request is rejected and no task is opened.
- `manual`: a task is opened. Money moves when that task is completed. The operations that move money are `activate`, `charge`, `extend`, `switch`, and `disconnect`. `sim`, `freeze`, `unfreeze`, and `rename` do not.
- `auto` and a successful provider outcome: the office applies the operation now.
- `auto` and a failed provider outcome: a task is opened. Money waits for that task.

`unfreeze` reads the `freeze` mode. Provider and package settings list every catalog key except `unfreeze`, including `companySwitch`. A line locked for a package switch still refuses other operations, as it does today.

## Run rules

`activate` creates a line. The generated number is chosen in the office. Neod and Tokman input rules are data on the `activate` definition, keyed by that provider's code. They are not a call to those providers. The provider codes are fixed when those providers are added to the catalog.

`charge` is the restart of a disconnected line. It follows the `charge` mode. On success it charges the package subscription price (`posPrice`), sets the line `active`, and sets `endsAt` to a new period from today. New restarts are recorded as `charge`. Rows already stored as `reactivate` stay as they are. `activate` is not used on an existing line.

`extend` is the renewal of an active line still inside its paid window. It keeps the current renewal price and the current window update.

`rename` updates the live line number only. Wallet rows, tasks, and provider-operation rows keep the number written on them at the time. A search for the old number returns those records. It does not open the live line. The live line is found by its current number.

`disconnect`, `switch`, `sim`, and `freeze` keep their current money and status behavior. Eligibility follows the catalog above, so disconnect and freeze run on an active line, and unfreeze runs on a frozen line.

## Non-goals

- Fields and execution for `companySwitch`.
- Extra jobs such as added gigabytes, and creating an operation from a screen without code.
- Calling an external provider from the catalog.
- Rewriting existing packages from the current provider map.
- Rewriting historical `reactivate` rows, or rewriting numbers already stored on old records.

## Verification

- A new package copies its provider map. A later provider edit leaves that package as it was.
- An `off` operation is missing on the numbers list, the number page, and the activation dialog, and the API rejects it.
- `auto` with a failed provider outcome opens a task and does not move money until the task is completed.
- `charge` restarts a disconnected line. `extend` runs only while the line is active and the window has not ended. `activate` creates a line and does not run on an existing one.
- After `rename`, a search for the old number returns the old records only, and the live line is listed under the new number.
- `companySwitch` can be saved on a provider and on a package, and a run request is rejected.
