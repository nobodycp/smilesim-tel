# 0002 — zod for API input validation

Date: 2026-11-08 · Status: accepted (owner)

## Context
`office.dto.ts` is Swagger-only (every field optional). Request bodies are typed `unknown` and parsed by hand inside `office.service.ts`, inconsistently. No `ValidationPipe` exists.

## Decision
Each route declares a zod schema in `<domain>.schemas.ts`. One `ZodPipe` validates and types the body/query, and maps failures to the existing `{ message, code }` error shape (`INVALID`). Schemas also feed the OpenAPI document.

## Consequences
- Business rules stay in the service/rules files; shape validation moves to the edge.
- Migration route group by route group (Phase 2.4), behaviour-preserving: same error codes for the same bad inputs.
