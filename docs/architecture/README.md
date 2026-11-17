# Architecture maps

Text codemaps (read these first, keep them current): [`frontend.md`](./frontend.md), [`backend.md`](./backend.md). Decisions: [`decisions/`](./decisions/). File and symbol relationships: the graphify graph (`CLAUDE.md`, "graphify").

What no refactor may change about money: [`financial-invariants.md`](./financial-invariants.md).

## Backend (API mapping)

Interactive OpenAPI / Swagger UI (local / non-production only):

- URL: `http://127.0.0.1:3001/docs` (or your `PORT`)
- Covers `health`, `auth`, and every `/v1` route; cookie `sid` + header `x-door`
- Spec: [`docs/superpowers/specs/2026-11-02-api-swagger-mapping-design.md`](../superpowers/specs/2026-11-02-api-swagger-mapping-design.md)

Not mounted when `NODE_ENV=production`.
