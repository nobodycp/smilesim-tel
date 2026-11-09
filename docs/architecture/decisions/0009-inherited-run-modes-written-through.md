# 0009 — Inherited run modes are written through

Date: 2026-11-09 · Status: accepted · Spec: `docs/superpowers/specs/2026-11-09-admin-review.md`, section 3

## Context

The owner wants a package's run settings («مباشر» or «مهمة فرع» per operation) to come from its provider, folded,
unless changed on the package. Until now a provider's modes were copied into a package once, at seed, and never read
again; every operation reads the package's own map and boolean pairs (`resolvePackageMode`) in many places.

## Decision

`Package.inheritedModes` lists the actions that follow the provider. The package still stores a concrete mode for each
of them — the provider's — and `ProvidersService.setMode` writes the new mode onto every package that inherits that
action, in the same transaction as the provider. `PackagesService.setMode` takes `inherit` (follow again: copy the
provider's mode now, add the action to the list) or a concrete mode (a mode of its own: drop it from the list).

Existing packages inherit nothing: their stored modes stay theirs, so no operation behaves differently.

## Alternatives

- **Resolve at read time** (package override → provider → manual inside `resolvePackageMode`). Every reader would
  need the provider loaded; several line paths load the package without it, so one missed include would run an
  operation in the wrong mode.

## Consequences

Readers are unchanged. A provider change costs one write per inheriting package (a handful). The sheet answers
`inheritedModes` and `providerModes` so the page can show «موروث من المزود» or «مخصص».
