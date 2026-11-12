# Production settings checked at start; no provider simulation in production — plan

Spec: `docs/superpowers/specs/2026-11-10-production-config-and-simulation.md`. ADR 0016. Paths under `apps/api/`
unless said. Local only: not pushed, not deployed.

- [x] **P.1 Check.** `src/production-config.ts` (`productionConfigProblems`, `assertProductionConfig`,
  `ProductionConfigError`, `trustedProxyHops`); `src/config.ts` loses `productionWarnings`; `src/main.ts` asserts
  before `NestFactory.create`, exits 1 with the problems. Spec `src/production-config.spec.ts`.
- [x] **P.2 Gateway.** `providers/gateway/provider-gateway.ts` (`simulated`, `NOT_CONNECTED`),
  `simulated-gateway.ts` (off in production), `lines/lines.service.ts` `route()`. Spec
  `providers/gateway/simulated-gateway.spec.ts` (gateway alone; line operations in test and in production; the
  branch completes the task by hand).
- [x] **P.3 Sign-in limit.** `src/rate-limit.middleware.ts`: no production skip; one log line for `TRUST_PROXY=0`
  with a forwarded header. `src/rate-limit.middleware.spec.ts`.
- [x] **P.4 Deployment files.** Root `docker-compose.yml`, `docker-compose.override.yml`, `.env.example`.
- [x] **P.5 Maps.** (slice commit b07a6b6) `docs/architecture/backend.md`, ADR 0016 (0011 marked as changed by it).

## Before a deploy (owner; nothing here was done on the server)

A production API on this code stops at start until the api service has, in Coolify:

| Variable | Value |
|---|---|
| `COOKIE_SECURE` | `true` |
| `WEB_ORIGIN` | the public https origins of the four doors, comma-separated, no path |
| `REDIS_URL` | the Redis address (`redis://` or `rediss://`) |
| `TRUST_PROXY` | the counted number of proxy hops between the browser and the api |
| `SECRETS_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`), kept somewhere safe |
| `PROVIDER_SIMULATION` | unset, or `0` |
| `TRIAL_SEED`, `TRIAL_SEED_ALLOW_PRODUCTION` | unset, or `false` |

Order: set the variables → deploy → `npm run seal-secrets --workspace api` once → check the api log has no
`Refusing to start` and that a sign-in from two networks shows two addresses in the activity log (that proves
`TRUST_PROXY`).

**Counting the hops.** The browser reaches the api through the platform proxy and then the web's `/api` rewrite, so
the number is not 1 by default. Check it on the server before choosing: too low and every caller shares one address
(the 30-a-minute sign-in limit then applies to everyone together); too high and a caller can write their own
address in `X-Forwarded-For`.

**Staging keeps the simulation only as a non-production copy.** With `NODE_ENV=production` every operation becomes
a branch task. If the trial server must go on simulating, its api service is given `NODE_ENV=staging` on purpose
(the checks and the production-only rules are then off there); that is the owner's choice, not a default.

**Going back.** `git revert` of this slice's commit restores the warnings and the old gateway; no data was
migrated. Tasks opened in the meantime stay valid branch tasks.

## Corrected by slice S.12a of `2026-11-10-activation-settlement.md` (ADR 0019, D18), 2026-11-13

- "A trial server may set `NODE_ENV=staging` to keep the simulation" no longer applies to a deployment that will
  dispatch to a provider: that staging is `NODE_ENV=production` with `PROVIDER_TARGET=sandbox`, checked as
  production is.
- The production check gained the dispatch settings (`PROVIDER_DISPATCH`, `PROVIDER_ADAPTERS`, `PROVIDER_TARGET`),
  and the worker runs its own check (`assertWorkerConfig`) before it opens anything.
- `providerDispatchOn()` is removed; `PROVIDER_DISPATCH=1` alone switches nothing on, in any environment.
