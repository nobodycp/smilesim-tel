# Areen (عرين) — provider integration, working document

Status: **discussion, nothing built.** Started 2026-11-17. This is the single place for everything we learn and decide
about connecting Areen. Each section says whether a fact comes from the vendor's documentation (**doc**), from the owner
(**decision**), or from a real call on our system (**verified**). Nothing is **verified** yet.

Focus: **Postpaid only.** Prepaid (Kalam, Simfony, Rami Levy, We, 019) and Games are out of scope for now.

Source: Postman documentation "AreenAPIsWithDoc", version 1.43, last updated 2026-09-07
(`https://documenter.getpostman.com/view/4741613/UzBnrmem`).

Areen has no integration of its own for us: no sandbox contract, no webhooks, no idempotency. Every behaviour below that
the doc does not state is settled by a **live test on our system** and recorded in the test log at the end.

## 1. What Areen is

An aggregator in front of several operators. We talk to Areen, Areen talks to WECOM, XPhone, Cellcom and others.
The operator name travels in each request as `ProviderName`.

- Authentication: `POST /Login` with Basic auth returns `{ "token": "…" }`; every other call carries it. `403` for a
  wrong password or an account not enabled for the API. (doc)
- The caller's **fixed IP** must be registered with Areen. (doc) Our worker must send from a fixed IP.
- A username is enabled for testing first and later converted to production **without code changes**. (doc)
- Every answer: `{ StatusCode, Message, Data? }`. `Message` is Arabic text. The code list is `GET /api/Common/GetErrorCodes`
  (not read yet). (doc)
- No idempotency key, no webhook, no status-by-reference call. A request that times out cannot be told from one that
  failed except by asking about the number afterwards (`GetMobileInfo`). (doc, by absence)

## 2. Decisions

| # | Decision | Date |
|---|---|---|
| D1 | Areen's operators ("companies") are entered **by hand** after querying Areen manually. Their names at Areen may differ from ours; **we do not rename ours**. The adapter translates our company to Areen's `ProviderName` at call time. | 2026-11-17 |
| D2 | Operator SIM rules (serial length, prefix, eSIM support, eSIM price) are entered by hand, as for any provider. | 2026-11-17 |
| D3 | One fixed price per **program** is normal for a provider. **Offers** come with two prices (see 4.4). | 2026-11-17 |
| D4 | `GetSpecialOffers` is for **renewing an existing number on an offer**. Later: when a point of sale renews, show that number's offers. Studied in a later phase, not now. | 2026-11-17 |
| D5 | Unclear behaviour is found by **live testing on our system**, and the finding is written here. | 2026-11-17 |

## 3. Postpaid endpoints (all `POST`, token required)

### Catalog

**GetPrograms** `/api/AreenPostpaid/GetPrograms` — body `{ ProviderName, HasCommission }`. (doc)

Answer `Data[]`: `ID`, `Name`, `ProviderName`, `Note`, `Internet`, `Minutes`, `SMS`, `PercCommission`, `Price`
(documented as the cost price, integer), `NumOfMonths` (string).

**GetNumbers** `/api/AreenPostpaid/GetNumbers` — body `{ ProviderName, ProgramID, Is_eSIM }`. Answer `Data[]` of
`{ MobileNumber }`, possibly empty. (doc)

### New subscription

**NewMobileAccount** — body `{ ProviderName, CustomerName, ProgramID, Is_eSIM, MobileNumber, SIMNumber, Amount }`;
for a port-in also `IsNeod: true` and `OTP`. Example answer: `StatusCode 25`, `MobileNumber`, `eSIMQRCode`, `SIMNo`. (doc)

**SendOTPForNeod** — sends the code to the customer for a port-in; example answer `StatusCode 16`. Providers named in the
doc: WECOM, XPhone. (doc)

### Existing number

| Call | Body | Purpose |
|---|---|---|
| `CheckToCharge` | `{ MobileNumber, Amount }` | Pre-check; returns messages with `Code` (e.g. 51 = permanently disconnected) and asks "continue?". |
| `Charge` | `{ MobileNumber, Amount }` | Charge an **amount** (not a package). Example answer `StatusCode 8`. A negative amount appears in the doc's example; meaning unknown. |
| `GetMobileInfo` (Postpaid) | `{ MobileNumber }` | State of a number (fields below). |
| `GetSpecialOffers` | `{ MobileNumber }` | Special programs for this number. Example answer was empty. |
| `ReplaceSIM` | `{ MobileNumber, SIMNumber, Is_eSIM }` | Example answer `StatusCode 30`, may return `eSIMQRCode`. |
| `ActivateMobile` / `DeactivateMobile` | `{ MobileNumber }` | The customer needs enough credit to activate. |

### Common

| Call | Purpose |
|---|---|
| `Common/GetMobileInfo` | Unified (prepaid and postpaid) since 2026-09-07; returns `AccountType`. |
| `Common/RefreshMobile` | `{ MobNumber }`; error `993` if the number is not the branch's, success `23`. |
| `Common/GetUsageInfo` | Used and total GB, minutes, SMS. |
| `Common/GetErrorCodes` | The list of status codes. **Must be read before any adapter work.** |

`GetMobileInfo` answer fields seen in the doc's example: `AccountType`, `CustomerID`, `CustomerName`, `SIMNumber`,
`LastChargeDate`, `LastChargeAmount`, `ProgramName`, `StatusName`, `ProviderName`, `CostMonthly`, `RemainingDays`,
`CountOfMobileAccounts`, `CustomerBalance`, `HasSpecialOffers`, `SpecialProgCommission`, `ProgMinChgAtChg`.

## 4. Mapping to our system

### 4.1 Catalog (what "add a package from the provider" reads)

Our port: `ProviderAdapter` (`apps/api/src/modules/providers/directory/adapters/provider-adapter.ts`), with `companies()`
and `products(companyCode)`.

| Ours (`ProviderProduct`) | Areen `GetPrograms` | Note |
|---|---|---|
| `code` | `ID` | Stored as `Package.providerProductCode`. |
| `name` / `details` | `Name` / `Note` | |
| `dataGb` / `minutes` / `smsCount` | `Internet` / `Minutes` / `SMS` | Unit of `Internet` and the "unlimited" value are unknown (we use `-1`). |
| `months` | `NumOfMonths` (string) | Parse and validate. |
| `cost` | `Price` | Documented integer, but `GetMobileInfo` shows decimals (29.9). Ours is integer agorot: convert with no rounding error. |
| `renewalCost` | none | See 4.4. |
| `addons` | none | `GetSpecialOffers` is per number, not a product list. |

`companies()` has no Areen call behind it: see D1 and D2.

### 4.2 Operator names (D1)

Our company is the catalog root (ADR 0008). Areen's `ProviderName` is a separate value. It must be stored as the
adapter's own mapping, never by renaming our company. **Where it lives (adapter table or a field on the company) is an
open design point** for the spec.

### 4.3 Operations

| Ours (`Action`) | Areen Postpaid | Notes |
|---|---|---|
| `activate` | `GetNumbers` then `NewMobileAccount` (+ `SendOTPForNeod` for port-in) | Multi-step; the number is chosen **before** the call. Our activation today creates the number as its result. |
| `charge` / `extend` | `CheckToCharge` then `Charge` | Charge is by amount. |
| `sim` / `esim` | `ReplaceSIM` | |
| `reactivate` | `ActivateMobile` | |
| `disconnect` | `DeactivateMobile` | |
| `refresh` | `Common/RefreshMobile` | |
| `rename`, `switch`, `freeze`, `unfreeze`, `addon` | none seen | Settle by live test or leave manual. |

### 4.4 Prices (D3, D4)

A program has one cost price. An **offer** (`GetSpecialOffers`) returns two prices; the doc's example was empty, so
**which two they are (subscription and renewal?) is unverified**. `GetMobileInfo` also gives `CostMonthly` and
`ProgMinChgAtChg` (minimum charge), which suggests Postpaid charging has a minimum amount. Settle by live test.

## 5. Differences that can hurt

1. **No idempotency, no webhook.** A timed-out `Charge` or `NewMobileAccount` may have run. Our `unknown` state
   (ADR 0017, 0018) is the right shape; the check is `GetMobileInfo` (`LastChargeDate`, `LastChargeAmount`). What exactly
   proves a charge happened is to be settled by test.
2. **Charge is an amount, not a package.** Our sale model prices a package. Needs an owner decision (open question Q1).
3. **Activation is chosen-number-first and may be two steps** (port-in OTP). Today an activation is one operation.
4. **Money**: Areen uses shekels with decimals; we use integer agorot.
5. **Fixed IP** for the worker, in the deployment.
6. **Messages are Arabic text**; we store codes only (`OPERATION_ERRORS`). A map from Areen's `StatusCode` to ours is needed.

## 6. Open questions

| # | Question | How to settle |
|---|---|---|
| Q1 | Is a Postpaid sale a fixed-price package for us, or a free amount? | Owner. |
| Q2 | Do we buy new subscriptions through Areen, or only charge existing numbers? | Owner. |
| Q3 | Unit of `Internet`, value for unlimited, meaning of `PercCommission`. | Live call. |
| Q4 | What the two prices of an offer are. | Live call. |
| Q5 | Meaning of a negative `Amount` in `Charge`. | Ask Areen; do not test with money. |
| Q6 | Behaviour on timeout; how to prove a charge ran. | Live test with a small amount. |
| Q7 | Is there a test environment, and with which IP? | Ask Areen. |
| Q8 | The full `StatusCode` list. | `GetErrorCodes`. |

## 7. Phases (one verified slice at a time)

1. **Scope and answers**: settle Q1, Q2, Q7, Q8. Then a spec and a plan in `docs/superpowers/{specs,plans}/`.
2. **Read-only**: login, `GetPrograms`, `GetMobileInfo`. No money moves. Proves the token, the IP and the field types.
3. **Catalog sync** into "add package from provider", with the name mapping (D1).
4. **Charge** with `CheckToCharge`, checked afterwards by `GetMobileInfo`.
5. **New subscription**: numbers, OTP, eSIM.
6. **Other operations**, then **matching**.
7. **Offers on renewal at the point of sale** (D4).

## 8. Live test log

Empty. One row per real call: date, call, what we sent (no secrets), what came back, what it settled.

| Date | Call | Result | Settles |
|---|---|---|---|
