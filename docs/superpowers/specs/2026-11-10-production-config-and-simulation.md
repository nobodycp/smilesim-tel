# Production settings are checked at start; providers are never simulated in production — spec

Owner task 01, 2026-11-10. Backend only: no route, response shape, schema, money or web change.

## Today (commit d616686)

- `config.ts` `productionWarnings()` lists unsafe production settings and `main.ts` logs them. Nothing stops the
  process: a production API runs with plain-HTTP cookies, the local CORS origin, no Redis, no `SECRETS_KEY`, and
  trial accounts if both trial flags are set.
- `SimulatedProviderGateway` is on unless `PROVIDER_SIMULATION=0`, in production too (ADR 0011). With it on, the
  request's `outcome` decides whether an operation "ran at the provider": any signed-in account can report success
  and have the line and the wallets written as if the provider had done the work.
- `LinesService.route()` reads the same field itself for a package run by hand (`outcome: 'fail'` marks the task
  as a provider failure), and a gateway that answers "not connected" is also stored as a provider failure, which
  the provider-health check counts.
- `rate-limit.middleware.ts` skips the per-address sign-in limit in production when `TRUST_PROXY` is unset, with a
  boot warning only. `main.ts` reads `TRUST_PROXY` with `Number()`.
- `docker-compose.yml` does not pass `TRUST_PROXY` or `PROVIDER_SIMULATION` to the api, so a compose deployment
  cannot set them. Local `docker compose up` runs the production image with both trial flags on.

## Decisions

1. **One check, before anything opens.** `src/production-config.ts`: `productionConfigProblems(env)` is pure and
   takes the environment as an argument; `assertProductionConfig(env)` throws `ProductionConfigError`. `main.ts`
   calls it first, logs the problems and exits with code 1. It replaces `productionWarnings()`. Outside
   `NODE_ENV=production` it checks nothing.
2. **What production must have.** `COOKIE_SECURE` exactly `true`; `WEB_ORIGIN` one or more https origins with no
   path; `REDIS_URL` a `redis://` or `rediss://` address; `TRUST_PROXY` a whole number ≥ 0; `SECRETS_KEY` 32 bytes
   of base64. **What it must not have:** `PROVIDER_SIMULATION` set to anything but `0`; `TRIAL_SEED` or
   `TRIAL_SEED_ALLOW_PRODUCTION` set to `true`.
3. **Messages name the variable and the rule, never the value.**
4. **`TRUST_PROXY` is a statement, not a guess.** `0` = callers reach the API directly; `n` = n proxy hops. Unset
   in production = no start. The API never trusts `X-Forwarded-For` on its own. The sign-in limit is no longer
   switched off anywhere. With `TRUST_PROXY=0` and a forwarded header on a sign-in request, the limiter says once
   in the log that the statement may be wrong; it does not act on the header.
5. **Production never simulates, whatever the environment says.** `SimulatedProviderGateway.simulated` is false in
   production; the hint is not read and not validated, `run` answers `not-connected`. The boot check on
   `PROVIDER_SIMULATION` is a second line, not the only one.
6. **"Not connected" is a plain branch task.** `route()` stores `BRANCH_TASK_NOTE` for it, not
   `PROVIDER_FAILED_NOTE`: nothing failed at a provider, and the health check must not count it. The request's
   hint counts only while `gateway.simulated` is true. The port gains `readonly simulated` and `NOT_CONNECTED`.
7. **Development and test are unchanged**: simulation on, hint required, trial seed as before.
8. **Local Docker is a development copy.** `docker-compose.override.yml` sets `NODE_ENV: development` for the api.
   `docker-compose.yml` passes `TRUST_PROXY` and `PROVIDER_SIMULATION` through.

## Non-goals

- A real provider adapter; removing `outcome` from the API or the web; the simulated catalog adapter and the
  simulated provider charges (`match-simulator.ts`, money).
- The worker's settings (it needs `REDIS_URL` and already stops without it).
- Any change on the staging server. The staging API runs the production image and today leans on the simulation,
  the trial accounts and missing settings: **it will not start on this code until its environment is set** (see
  the plan's "Before a deploy").
