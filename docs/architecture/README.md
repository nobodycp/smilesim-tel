# Architecture maps

Visual maps of `smilesim-tel`. Open the `.excalidraw` files with the **Excalidraw** extension in Cursor (`pomdtr.excalidraw-editor`) or [excalidraw.com](https://excalidraw.com).

If a file still opens as raw JSON: Command Palette → **Developer: Reload Window**, then open the file again (or right-click → **Open With…** → **Excalidraw**).

## Frontend (this slice)

| Board | File | What it answers |
|---|---|---|
| Components tree + file roles | [`web-components-tree.excalidraw`](./web-components-tree.excalidraw) | Where each `apps/web` source file sits and what it is for |
| State / data / errors | [`web-state-dataflow.excalidraw`](./web-state-dataflow.excalidraw) | Boot, contexts, page → API flow, session-ending errors, shell identity |

Spec: [`docs/superpowers/specs/2026-11-02-web-architecture-excalidraw-design.md`](../superpowers/specs/2026-11-02-web-architecture-excalidraw-design.md).

**Update rule (D5):** when a frontend file is added, removed, or changes responsibility, update the matching board in the same change (or immediately after). Rebuild from the catalogue with:

```bash
node docs/architecture/generate.mjs
```

## Backend (API mapping)

Interactive OpenAPI / Swagger UI (local / non-production only):

- URL: `http://127.0.0.1:3001/docs` (or your `PORT`)
- Covers `health`, `auth`, and every `office` route; cookie `sid` + header `x-door`
- Spec: [`docs/superpowers/specs/2026-11-02-api-swagger-mapping-design.md`](../superpowers/specs/2026-11-02-api-swagger-mapping-design.md)

Not mounted when `NODE_ENV=production`.

## Later

Backend structural maps (Nest modules → Prisma / Redis / BullMQ as Excalidraw) remain a separate slice.
