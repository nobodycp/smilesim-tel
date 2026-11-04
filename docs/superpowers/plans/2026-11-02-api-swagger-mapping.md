# API Swagger mapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive OpenAPI/Swagger UI at `/docs` (non-production) documenting every health, auth, and office endpoint.

**Architecture:** `@nestjs/swagger` in `main.ts`; shared error DTO from `errors.ts`; auth/office DTO classes + controller decorators; no ValidationPipe; no production exposure.

**Tech Stack:** NestJS 12, `@nestjs/swagger`

## Global Constraints

- `/docs` only when `NODE_ENV !== 'production'`
- No global ValidationPipe / behaviour change to live responses
- Cookie `sid` + header `x-door` in the OpenAPI document
- Spec: `docs/superpowers/specs/2026-11-02-api-swagger-mapping-design.md`

---

### Task 1: Dependency + bootstrap `/docs`

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/src/openapi/setup.ts`
- Create: `apps/api/src/openapi/error.dto.ts`

- [x] Install `@nestjs/swagger` in the `api` workspace
- [x] `setupOpenApi(app)` builds DocumentBuilder (cookie `sid`, apiKey `x-door`) and mounts `/docs` when not production
- [x] Error DTO with `message` + `code` enum from `ERROR_MESSAGES` keys

### Task 2: Auth + health documentation

**Files:**
- Create: `apps/api/src/modules/auth/auth.dto.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `apps/api/src/health.controller.ts`

- [x] DTO classes for every auth body
- [x] `@ApiTags` / `@ApiOperation` / `@ApiBody` / `@ApiResponse` / cookie auth on auth routes
- [x] Health: tag + `{ ok: true }` response schema

### Task 3: Office documentation

**Files:**
- Create: `apps/api/src/modules/office/office.dto.ts`
- Modify: `apps/api/src/modules/office/office.controller.ts`

- [x] DTOs for every office body; free-form bodies use object schema with `additionalProperties`
- [x] Decorate every office route (tags by area where helpful)
- [x] Document query/path params

### Task 4: Docs pointer + verify

**Files:**
- Modify: `docs/architecture/README.md`

- [x] Backend section linking to local `/docs`
- [x] `npm run typecheck:api` passes
- [x] Spot-check: OpenAPI path count ≥ controller route count (73 routes / 73 `@ApiOperation`)
