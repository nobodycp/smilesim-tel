# API Swagger mapping — design

## Why

The NestJS API (`apps/api`) exposes dozens of `auth` and `office` routes that the web client
calls through `lib/api.ts`. Without an interactive map, discovering methods, bodies, door header
rules, and `{ message, code }` refusals means reading controllers. The frontend architecture
boards already cover the web tree; this slice adds the matching **backend endpoint map** via
Swagger UI for local development.

## Goal

Ship OpenAPI + Swagger UI at **`/docs`** when `NODE_ENV !== 'production'`, documenting **every**
endpoint on `HealthController`, `AuthController`, and `OfficeController` with operation summary,
parameters, request bodies, success shapes where stable, and the shared error body — so agents and
humans can map frontend calls to backend routes without diving the files first.

## Non-goals

- No Swagger (or OpenAPI JSON) exposed in production.
- No global `ValidationPipe` / class-validator enforcement in this slice (runtime validation stays
  in existing controller/service checks). DTOs exist for OpenAPI schemas and typing at the
  controller boundary for documentation, not a behaviour change.
- No change to business rules, cookies, CORS, or error codes.
- No separate hand-maintained YAML as the source of truth.
- No password-gate on `/docs` (dev-only is the gate).
- Backend Excalidraw boards and Madge graphs are out of scope here.

## Decisions

**D1 — Stack.** `@nestjs/swagger` wired in `main.ts` with `SwaggerModule.setup('docs', …)` only
when `process.env.NODE_ENV !== 'production'`.

**D2 — Depth.** Full coverage (option C): every auth and office (and health) route appears with
documented body/params/responses, not path-only stubs.

**D3 — Security document.** OpenAPI security schemes:
- Cookie auth: `sid` (httpOnly session cookie used by the office).
- Header: `x-door` (door host key: `admin` | `main` | `agent` | `pos`), documented globally and
  required where the live API expects it.

**D4 — Error schema.** One reusable component derived from `apps/api/src/errors.ts`:
`{ message: string, code: ErrorCode }` with the known code enum listed. Endpoints that refuse
reference this schema for 4xx (and documented status codes per operation where known).

**D5 — DTO layout.**
- `apps/api/src/openapi/error.dto.ts` — shared error (+ optional helpers).
- `apps/api/src/modules/auth/auth.dto.ts` — auth request/response DTOs.
- `apps/api/src/modules/office/office.dto.ts` — office DTOs; split into sibling files
  (`office-lines.dto.ts`, etc.) only if a single file becomes unwieldy during implementation.
- Controllers switch `@Body()` inline types to these DTO classes; keep `@Res({ passthrough: true })`
  patterns unchanged.

**D6 — Response fidelity.** Where `response-shape` tests or stable client types fix the shape,
document explicit properties. Where the payload is large or polymorphic, document the stable core
fields and a short description rather than inventing fields.

**D7 — Tags.** At minimum: `health`, `auth`, `office`. Optional subgroup tags under office
(wallets, packages, lines, users, tasks, notices, reports, accounting, audit) for readability in
Swagger UI — allowed if they do not hide any operation.

**D8 — Docs pointer.** Add a short note under `docs/architecture/README.md` (Backend section)
linking to `http://127.0.0.1:3001/docs` for local API mapping. No new Excalidraw in this slice.

## Architecture

```text
main.ts
  └─ if not production → DocumentBuilder + SwaggerModule.setup('docs')
controllers (health | auth | office)
  └─ @ApiTags / @ApiOperation / @ApiBody / @ApiParam / @ApiResponse / @ApiCookieAuth …
dto modules
  └─ class + @ApiProperty* → OpenAPI schemas
errors.ts
  └─ ErrorCode list → error DTO enum (stay in sync)
```

Try-it-out uses the same cookie + `x-door` semantics as the real app. Operators log in via
`POST /auth/login` from the UI (or an existing browser session on an allowed origin); no new auth
mechanism.

## Verification

- With API running and `NODE_ENV` not `production`, `GET /docs` returns Swagger UI; OpenAPI JSON
  is reachable (Nest default under the docs setup).
- With `NODE_ENV=production`, `/docs` is not registered (404 or absent route).
- OpenAPI path list includes every route currently declared on the three controllers (checklist
  against `@Get|Post|Put|Patch|Delete` counts).
- `npm run typecheck:api` (or workspace equivalent) passes; existing `npm run test:api` stays green.
- No intentional change to response bodies of live endpoints.

## Outcome

Local developers and agents open `/docs` for an interactive map of all auth/office/health
endpoints, bodies, door header, session cookie, and refusal codes — aligned with the frontend’s
`api.ts` without replacing it.
