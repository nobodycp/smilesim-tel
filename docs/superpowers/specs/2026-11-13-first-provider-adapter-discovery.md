# First provider adapter: discovery and technical specification (S.12b.1)

- **Date:** 2026-11-13
- **Base commit:** `859cd3e5e4092bebe013c6d20bee1f8571ae446b`
- **Status:** discovery finished. **Decision: S.12b cannot start.** No provider's API documentation exists in the
  repository, so no adapter can be specified without inventing its contract.
- **Scope:** documents only. No adapter, no endpoint, no credential, no setting, no deployment.
- **References:** ADR 0017, 0018, 0019 (D8, D11, D13, D17, D18, "S.12b.0"); `adapter-manifest.ts`;
  `provider-adapters.ts`; `dispatch-gate.ts`; `provider-operation.rules.ts`; `provider-dispatch.ts`.

Every statement about SmileSim below is read from the code at the base commit. Every statement about a provider is
marked **UNRESOLVED** unless a document proves it; today none does.

## 1. Inventory of providers

### 1.1 How a provider is defined

- A `Provider` row (`schema.prisma`): `code` (unique), `name`, `actionModes` (per-operation `auto` / `manual` /
  `off`), `matchSource` (`api` or `statement`), money limits, health, and the D18 approval and pause columns.
- Providers are seeded once from `office-catalog.ts` (`CatalogSeed`, only into a database with no provider) or added
  by the owner in the office. A provider owns `Package` rows; a package also names a `Company` (the network
  operator). The provider's own product code is `Package.providerProductCode`.
- A provider has no endpoint, no protocol and no documentation field anywhere in the model. The catalog a provider
  "answers" (`ProviderAdapter.companies/products`) is `SimulatedProviderAdapter`: made up from the seed, by the
  owner's instruction («ابني وهمي حالياً»).
- `matchSource = 'api'` does **not** mean the provider has an API: matching is simulated (`match-simulator.ts`).
  A provider's name or settings prove nothing about an API.

### 1.2 The providers in the code

| Code | Name | Source | Companies it sells (seed) | Activation input (`activateInputs`) | API documents in the repository |
|---|---|---|---|---|---|
| `sky` | سكاي | seed | cellcom, hot, pelephone | `generated` | none |
| `lian` | ليان | seed | wecom, rami, hot, partner, 019 | `generated` | none |
| `aren` | عرين | seed | cellcom, wecom | `generated` | none |
| `quickline` | كويك لاين | seed | cellcom | `generated` | none |
| `alloha` | الوها | seed | alloha, wecom, cellcom | `generated` | none |
| `neod` | — | named only in `run-modes.ts` | not seeded | `current-details` | none |
| `tokman` | — | named only in `run-modes.ts` | not seeded | `number-and-sim` | none |

Searched: every tracked file for OpenAPI / Swagger / Postman / HAR / PDF files and for the words endpoint, sandbox
and API documentation next to a provider. Found only SmileSim's own OpenAPI set-up (`apps/api/src/openapi`). The
business plan says the same: «الربط الحقيقي مع المزودين عبر API … نتناقش فيه من جديد بعد توفر وثائق المزودين»
(`docs/project-plan.md`, "مستقبلي"). `docs/client/` is untracked and was not opened; its two file names are a
status page and a proposal, not provider documents.

### 1.3 What SmileSim supports today, per provider

The same for every provider, because nothing is provider-specific except `activateInputs`:

- **Dispatched (ADR 0019 D13): `activate` only.** `lines.service.ts` opens a dispatched operation only when the
  package runs `activate` automatically and `gateway.dispatches(providerCode)` is true. Every other action
  (`charge`, `extend`, `reactivate`, `disconnect`, `freeze`, `unfreeze`, `switch`, `rename`, `sim`, `esim`,
  `refresh`, `addon`) is answered inside the request by the simulation or becomes a branch task.
- **Activation kinds** (`activateInputs`):
  - `generated`: the seller gives nothing or a number; the provider is expected to hand back the number, the
    serial and, for an eSIM, the activation code.
  - `number-and-sim` (`tokman`): the seller gives the number and the serial.
  - `current-details` (`neod`): the seller gives free text about an existing subscriber.
- **What is sent** (`OutgoingOperation`): `idempotencyKey`, `attempt`, `action`, `providerCode`, `packageCode`
  (the provider's product code), `msisdn | null`, `iccid | null`.
- **What may come back** (`ActivationResult`, D11): `msisdn` (digits, ≤ 20), `iccid` (digits, ≤ 22), `esimCode`
  (≤ 512, sealed before storage, never logged, D17).

## 2. Choosing the first adapter

| Criterion | sky | lian | aren | quickline | alloha | neod | tokman |
|---|---|---|---|---|---|---|---|
| Documented API | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED |
| Real sandbox | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED |
| Idempotency, or inquiry by our key | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED |
| Inquiry about a pending operation | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED |
| Clear error codes | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED |
| How ICCID, MSISDN, eSIM code come back | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED |
| Testable with no real money | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED |

**No provider can be ranked.** Nothing in the repository distinguishes them on any criterion.

What the code does say, as fit and not as evidence of an API:

- A `generated` provider exercises the whole of D11 and D17 (the provider's number, serial and eSIM code), which
  is the path with the most to verify. A `number-and-sim` provider is the narrowest contract (nothing secret comes
  back) and would be the lowest-risk first adapter **if** its API is otherwise equal.
- `current-details` (`neod`) cannot be dispatched as the code stands: the subscriber's text is not part of
  `OutgoingOperation` (section 6, G4).

**Selection rule for when documents arrive** (hard requirements first, then preference):

1. Hard: a written API document from the provider; a sandbox that moves no money; either an idempotency key the
   provider honours or an inquiry by our own reference; an inquiry that answers "done / not done / not found" for a
   request that got no answer.
2. Preferred, in order: stable machine-readable error codes; `number-and-sim` or physical-SIM-only for the first
   run; stated rate limits; a provider the office already sells with `activate: auto`.

A provider that fails any hard requirement is not a candidate for dispatch: its activations stay branch tasks.

## 3. Integration specification

No provider qualifies, so this section fixes **SmileSim's half** of the contract, which is known, and lists the
provider's half as questions. It is the template the real spec fills in; it invents nothing.

### 3.1 Fixed by SmileSim (from the code)

- **Where it lives.** One factory in `ADAPTER_FACTORIES` (`provider-adapters.ts`, worker only) and the same code in
  `SUPPORTED_ADAPTERS` (`adapter-manifest.ts`); a spec keeps the two equal. Nothing is added to the API.
- **Shape.** `AdapterFactory = (target, credential) => DispatchAdapter`; `DispatchAdapter.send(operation)` returns
  `SendEvidence` and never throws for a refusal. The factory for one target refuses the other.
- **Endpoints.** Constants in the adapter's own file, one set per target (`sandbox`, `live`). Never read from the
  environment, the database or the credential.
- **Credential.** One opaque string per (provider, target), sealed with `SECRETS_KEY`, written through the owner's
  route, opened only in the worker. If the provider needs several values (key and secret, client id), the string is
  one JSON object the factory parses and validates; a credential that does not parse builds no adapter.
- **Idempotency.** `OutgoingOperation.idempotencyKey` goes with every attempt of one operation and never changes
  between attempts. `attempt` is ours; it is not sent as the provider's key.
- **Timeout.** The dispatcher stops waiting at `CALL_TIMEOUT_MS` = 30 s; the adapter's own HTTP timeout must be
  shorter (proposed 25 s, connect 5 s) so the adapter reports its own evidence. The lease is 90 s.
- **Retry.** The adapter never retries inside `send`. Only `left: false` is sent again, by the dispatcher, up to
  `MAX_ATTEMPTS` = 5 spent attempts. Anything that may have left becomes `unknown` and is never sent again.
- **Evidence rule.** `left: false` only when no connection was opened and no byte written (DNS failure, connection
  refused, TLS failure before the request). Everything else is `left: true`.

### 3.2 Mapping an attempt to `SendEvidence` (transport half is fixed; provider half is UNRESOLVED)

| What happened | Evidence | Operation becomes |
|---|---|---|
| No adapter for the code | `left:false, not-connected` | `requested` again, or `failed` at the budget |
| DNS / connect refused / TLS handshake failed | `left:false, unreachable` | same |
| Request written, no response before the timeout | `left:true, none, timeout` | `unknown` |
| Connection dropped after the request was written | `left:true, none, connection-lost` | `unknown` |
| Response not parseable, or 5xx with no stated meaning | `left:true, none, provider-error` | `unknown` |
| Provider says done | `left:true, confirmed` + `providerRef` + `result` | `succeeded` |
| Provider says it did not run it, by a documented code | `left:true, refused, refused` | `failed` |
| Provider says our request is malformed, by a documented code | `left:true, refused, invalid-request` | `failed` |
| Provider says "accepted, in progress" | `left:true, none, provider-error` (inquiry decides) | `unknown` |
| Adapter threw, or the dispatcher's wait ran out | no evidence → `no-evidence` | `unknown` |

Rules that do not depend on the provider:

- `refused` is used **only** for a response the provider's document says means "not executed". An undocumented
  status, an authentication failure after bytes left, a rate-limit answer and any 5xx are `none`, not `refused`:
  a wrong `refused` releases the hold while the line may exist at the provider.
- The provider's message text is never stored or logged; only a code from `OPERATION_ERRORS`.
- No new `OPERATION_ERRORS` code is proposed now. If a provider's document shows a case the nine codes cannot
  carry, that is a decision for the real spec.

### 3.3 The provider's half: UNRESOLVED, to be answered from its document

| # | Item | Status |
|---|---|---|
| P1 | Authentication: scheme, token lifetime, refresh, IP allow-list, mTLS | UNRESOLVED |
| P2 | Sandbox base URL and live base URL; are they separate hosts and separate credentials | UNRESOLVED |
| P3 | Activation request: method, path, fields, formats of number, serial and product code | UNRESOLVED |
| P4 | Activation response: fields, where the provider's reference, MSISDN, ICCID and eSIM code are | UNRESOLVED |
| P5 | eSIM code form: LPA string, or a QR image, or a link; length; whether it can be read again later | UNRESOLVED |
| P6 | Idempotency: header or field name, key format and length (ours is 8–120 of `[A-Za-z0-9._:-]`), how long it is kept, what a repeat returns | UNRESOLVED |
| P7 | Synchronous or asynchronous completion; webhook or polling | UNRESOLVED |
| P8 | Status inquiry: by our key or by its reference; the answers for done, refused, in progress, **never seen** | UNRESOLVED |
| P9 | Error catalogue: which codes mean "not executed", which are retryable, which are ambiguous | UNRESOLVED |
| P10 | Rate limits, concurrency limits, maintenance windows | UNRESOLVED |
| P11 | Money: does a sandbox activation debit anything; how the provider's balance is read | UNRESOLVED |
| P12 | Product codes: do they equal `Package.providerProductCode`, per company | UNRESOLVED |
| P13 | Cancellation or reversal of an activation made in error | UNRESOLVED |
| P14 | Whether the provider's answers carry personal data that must not be stored | UNRESOLVED |

### 3.4 Status inquiry and `resolveUnknown`

- `resolveUnknown(id, verdict)` exists (`provider-operations.service.ts`) and is correct: it closes `unknown` only,
  never sends, and writes the `settled` message in the same transaction.
- **It has no caller outside tests.** There is no inquiry on `DispatchAdapter`, no job that asks a provider about an
  unknown operation, and no route by which a person closes one (section 6, G1–G3).
- Design for S.12b, once P8 is known:
  - `DispatchAdapter.inquire(operation): Promise<Verdict | null>`: `null` means "no verdict yet" (in progress,
    inquiry failed, answer not understood). **"Never seen" is a `failed` verdict only if the provider's document
    guarantees that a request it never saw can no longer arrive**; otherwise it is `null`.
  - A worker timer walks unknown operations by cursor (the same fairness as the sweeper), under the same send gate
    and permit as `send`, with a back-off per operation and a stated limit per round.
  - An inquiry never changes an operation except through `resolveUnknown`. A failed inquiry changes nothing.
  - An operation no inquiry closes within a stated age is announced to the branch, as today.

### 3.5 Protection of credentials and eSIM data

- Credential: sealed at rest, opened in the worker only, never in a log, an error, a queue payload, an attestation
  row or a `skipped` reason (all already enforced by `buildAdapters`).
- The adapter logs: operation id, attempt, an `OPERATION_ERRORS` code, HTTP status, duration. Never headers, bodies,
  the key's value or any part of `result`.
- `esimCode` leaves the adapter only inside `SendEvidence.result`, is sealed by the store (D17) and is never put in
  a notice, a queue job or an outbox payload.
- The HTTP client must not follow redirects to another host and must verify TLS; no proxy from the environment.

### 3.6 Rate limits and operating limits

- Provider's limits: UNRESOLVED (P10).
- Ours today: the waiting pass sends at most 100 a round; the queue's concurrency is the worker's setting. The
  adapter needs a per-provider limit only if P10 states one; then it is a constant beside the endpoints.

## 4. Test plan

Written against a **scripted HTTP server on the loopback**, started by the spec, so the real adapter code runs with
no provider and no money. Each case runs with PostgreSQL and Redis through the real dispatcher.

| # | Case | What must hold |
|---|---|---|
| T1 | Activation succeeds | `succeeded`; one line; one debit; the hold captured; number, serial and sealed eSIM code stored |
| T2 | Provider refuses by a documented code | `failed`; the hold released once; no line |
| T3 | No response within the adapter's timeout | `unknown`; the hold stays; nothing sent again |
| T4 | Connection dropped after the request was written | `unknown`, `connection-lost`; never `not-sent` |
| T5 | Connection refused before any byte | `requested` again; attempt counted; at five, `failed` and the hold released |
| T6 | The same idempotency key sent twice (redelivered job, two workers) | the server sees the same key; one line, one debit |
| T7 | A late answer after recovery marked the operation unknown | closes it once; a second late answer changes nothing |
| T8 | Provider down (5xx, then refused connections) | 5xx → `unknown`; refused connection → retried; provider health noticed once |
| T9 | Owner pauses, then resumes | nothing sent while paused; no attempt spent; waiting operations sent after resume, once |
| T10 | Credential replaced while a job is in flight | the old adapter sends nothing after the write; approval withdrawn |
| T11 | Inquiry answers done / refused | `resolveUnknown` once; one line or one release |
| T12 | Inquiry fails, times out or answers nonsense | the operation stays `unknown`; nothing moves |
| T13 | Inquiry says "never seen" | per P8: `failed` only with the provider's guarantee, else stays `unknown` |
| T14 | Sweeper, inquiry, redelivery and a late answer at once | exactly one line and one ledger entry; no deadlock |
| T15 | Worker stopped in order / killed mid-call | finishes the job / leaves `unknown`; never a second send |
| T16 | Response carries an oversized or malformed serial or code | the part is dropped, not cut; the sale still settles |
| T17 | Log capture across T1–T16 | no credential, no key value, no eSIM code, no response body |
| T18 | Wrong target | a sandbox factory refuses `live`; live endpoints are never opened in the suite |

Mutation tests: evidence downgraded from `left:true` to `left:false`; an undocumented status mapped to `refused`;
the key changed between attempts; inquiry sending instead of asking; "never seen" treated as failed without the
guarantee. Each must fail at least one test.

Not possible before documents: contract tests against the provider's real sandbox (S.12b's staging run).

## 5. Staging plan (requirements only; nothing is set up)

A deployment separate from production in every part:

- Three applications (web, API, worker) built from the same commit as production, `NODE_ENV=production`.
- Its own PostgreSQL database and its own Redis; never production's, never a copy holding real credentials.
- Its own `SECRETS_KEY`, set on the API **and** the worker application before the first start.
- `DEPLOYMENT_ID` of its own (for example `staging-1`), set on both.
- `PROVIDER_TARGET=sandbox` on both. The `live` credential is never stored there.
- The four conditions of D18, in this order, each checked before the next:
  1. `PROVIDER_ADAPTERS=<code>` on both; the worker attests; readiness shows.
  2. The sandbox credential written through the owner's route.
  3. `PROVIDER_DISPATCH=1` on both.
  4. The owner's approval for this deployment and target.
- Two accounts allowed to approve, pause and write the credential, each with two-factor sign-in, so one can stop
  the provider when the other is away. Their names are recorded in the handover register, not their secrets.
- Watching: the provider-operations screens; counts of `unknown` and of operations waiting; the worker's
  attestation age; provider health notices; the worker's log for `skipped` reasons.
- Stopping at once, from the mildest: the owner's pause (takes effect under the row lock, spends no attempt);
  withdrawing the approval; `PROVIDER_DISPATCH=0` and a restart; stopping the worker application.
- Before the first sandbox call: a backup taken and restored once; the migrations applied; the test catalogue's
  product codes confirmed against the sandbox (P12).
- Leaving staging for live needs the go-live gate of the plan, a separate decision.

## 6. Gaps in SmileSim found by this discovery

To be closed in S.12b's own spec; none is changed now.

- **G1.** `DispatchAdapter` has `send` only: no inquiry.
- **G2.** No worker job asks a provider about unknown operations.
- **G3.** `resolveUnknown` has no caller outside tests: no person's route closes an unknown operation either. Until
  one exists, an unknown operation holds its money until someone acts in the database. This must be closed before
  any provider is called, sandbox included.
- **G4.** `OutgoingOperation` carries no eSIM flag and no subscriber details: a `generated` eSIM is told apart from
  a physical SIM only by an empty serial, and `current-details` cannot be dispatched.
- **G5.** `activateInputs` names `neod` and `tokman`, which no seed creates: the rule is keyed on codes that exist
  only where the owner added them by hand.

## 7. What is needed from the owner

For at least one provider:

1. Its API document (PDF, OpenAPI, Postman collection or a link), added under `docs/providers/<code>/`.
2. Sandbox access: base URL and test credentials, given through the owner's credential route on staging, never in
   the repository or in chat.
3. Written answers to P1–P14 where the document is silent, above all P6, P8, P9 and P11.
4. Whether the provider's code in SmileSim is one of the seven above.

## 8. Decision

**We do not have enough information to start S.12b.** Zero of the seven provider codes has a documented API, a
sandbox, an idempotency rule or an inquiry in the repository. Writing an adapter now would mean inventing endpoints
and error codes, which the rules of this slice forbid and which would put money at risk.

What can proceed without a provider, if the owner approves it as its own slice: G1–G3 (the inquiry port, the
inquiry job and a person's route to close an unknown operation) and the scripted-server test harness of section 4.
