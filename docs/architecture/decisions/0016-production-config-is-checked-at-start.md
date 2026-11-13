# 0016 — A production API does not start with unsafe settings, and never simulates a provider

Date: 2026-11-10. Status: accepted (owner task 01). Changes ADR 0011's "on by default, in production too" and its
"warn rather than stop". Spec and plan: `docs/superpowers/{specs,plans}/2026-11-10-production-config-and-simulation.md`.

## Context

ADR 0011 left the simulation on in production and listed unsafe settings as boot warnings, because the staging
server runs the production image and a refusal would have taken it down. The cost was that a production API could
run with any signed-in account stating the provider's answer, without a sealing key, with trial accounts, and with
the per-address sign-in limit silently off when `TRUST_PROXY` was missing.

## Decisions

1. `src/production-config.ts` checks the environment before the app is created; a problem stops the process with
   the variable's name and the rule, never its value. The check is a pure function of the environment, outside
   every domain module.
2. `SimulatedProviderGateway` does not simulate when `NODE_ENV=production`, independent of the boot check. Its
   answer is `not-connected`, which `LinesService.route()` stores as a plain branch task, not a provider failure.
3. `TRUST_PROXY` must be stated (a whole number, `0` for none). The API does not infer proxies from headers, and
   the sign-in limit is never switched off.

## Alternatives

- **Keep warnings, add a health flag.** Shows the state but still sells on a simulated provider.
- **A second variable (`APP_ENV=staging`) that relaxes the check.** A new name to keep in step with `NODE_ENV`;
  a copy that is not production can say so with `NODE_ENV` itself.
- **Trust `X-Forwarded-For` when present.** A caller reaching the API directly could then pick their own address.
- **Require `PROVIDER_SIMULATION=0` to be written.** No safer than decision 2, and one more variable to forget.

## Consequences

- The staging API and local `docker compose up` no longer start as production with their old settings. Local
  Docker is now a development copy (`docker-compose.override.yml`); staging needs the variables in the plan, or a
  deliberate `NODE_ENV=staging`.
- In production every line operation is a branch task until a real gateway is bound to `PROVIDER_GATEWAY`.
- A wrong `TRUST_PROXY` is not detected at start: `0` behind a proxy is said once in the log; a number that is too
  high is the deployer's to rule out.

## Amended by ADR 0019, D18 (slice S.12a, 2026-11-13)

- **A staging deployment of the provider flow is production-grade.** The advice above, that a trial server may be
  given `NODE_ENV=staging` on purpose to keep the simulation, is withdrawn for any deployment that will dispatch:
  it runs `NODE_ENV=production` with `PROVIDER_TARGET=sandbox`, passes this check as production does, and
  simulates nothing. A copy that only demonstrates screens with simulated answers is a development copy.
- **The check now covers dispatch**, for the API and the worker alike (`dispatchConfigProblems`): the three
  variables `PROVIDER_DISPATCH`, `PROVIDER_ADAPTERS`, `PROVIDER_TARGET` must hold together (dispatch on needs a
  list and a target; a list or a target needs dispatch on; `1`, `sandbox`, `live` and provider codes exactly),
  and every provider named must be one the build has an adapter for. A process told to dispatch in a way that
  cannot be carried out does not start.
- **The worker is checked too** (`assertWorkerConfig`, the first statement of `worker.ts`'s `run`, before Redis
  or PostgreSQL is opened): `REDIS_URL`, `DATABASE_URL`, no simulation, the dispatch settings, and `SECRETS_KEY`
  when it is to dispatch. Messages name the variable and the rule, never the value.

## Amended by the final corrections of S.12a (2026-11-13)

- **`DEPLOYMENT_ID`** joins the dispatch settings: the deployment's name (3 to 63 lower-case letters, digits or
  `-`). With `PROVIDER_DISPATCH=1` it is required, for the API and the worker, and both must be given the same
  one. Malformed, it is refused whether or not dispatch is on. A deployment that does not dispatch need not set
  it. Approvals and worker attestations are written with it (ADR 0019).
- **What the build supports is read from a manifest of codes** (`dispatch/adapter-manifest.ts`), not from the
  adapters. The check that refuses a provider the build has no adapter for is unchanged in what it refuses; the
  API runs it without loading the code that reaches a provider, and needs no provider credential to start.
