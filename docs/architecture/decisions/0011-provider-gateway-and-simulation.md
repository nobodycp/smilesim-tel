# 0011 — Line operations go through a provider gateway; the simulation stays on until real providers exist

Date: 2026-11-10 · Status: accepted; the production default and the boot warnings are changed by ADR 0016 · Spec: `docs/superpowers/specs/2026-11-10-backend-hardening.md`, decision 12

## Context

Every line operation took `outcome: 'success' | 'fail'` from the request body and acted on it: the client said
whether the provider had run the operation. No provider is connected yet, so this was the only way to exercise the
office end to end, but it sat inside the services as if it were the contract.

## Decision

`providers/gateway/provider-gateway.ts` defines the port (`accept(hint)`, `run(request)`), bound to the token
`PROVIDER_GATEWAY`. `LinesService.route()` asks it only when the package runs the operation automatically; a refusal
opens a branch task marked as a provider failure. `SimulatedProviderGateway` is the only code that reads the
request's `outcome`, now called a hint. A real provider is a new class bound to the same token; nothing in the
services changes.

The simulation is **on by default**, in production too, and warns at boot there. `PROVIDER_SIMULATION=0` turns it
off: every operation then goes to a branch task.

## Alternatives

- **Refuse to start in production with the simulation on.** Safer, but the staging server runs the production
  image and depends on the simulation; a deploy would have taken it down. The boot warning and this ADR carry the
  risk instead.
- **Remove `outcome` from the API now.** The web app sends it on every operation; removing it is a web change, out
  of scope for the backend pass.

## Consequences

- Before real sales: connect a real gateway, or set `PROVIDER_SIMULATION=0`. Until then any signed-in account can
  state the provider's answer.
- The same pattern applies to `LogSender` (sign-in codes) and the origin check: they warn or degrade rather than stop
  a running copy, and `config.ts` `productionWarnings()` lists what to fix.
