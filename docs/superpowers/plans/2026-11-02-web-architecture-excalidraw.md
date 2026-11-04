# Web architecture Excalidraw maps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two Excalidraw boards plus a short README under `docs/architecture/` matching `docs/superpowers/specs/2026-11-02-web-architecture-excalidraw-design.md`.

**Architecture:** Generate valid `.excalidraw` JSON from an in-repo catalogue (Arabic role lines, English paths). Board 1 is a four-zone file tree; Board 2 is a five-band state/data/error flow. No runtime app changes.

**Tech Stack:** Excalidraw JSON v2, Node one-shot generator (optional, discarded or kept as `docs/architecture/generate.mjs` for rebuilds).

## Global Constraints

- Labels on boards: Arabic; paths/ids: English (spec D4).
- No Playwright / `.next*` / tests on boards.
- No changes under `apps/web` source for this slice.

---

### Task 1: Board 1 — components tree

**Files:**
- Create: `docs/architecture/web-components-tree.excalidraw`
- Create (helper): `docs/architecture/generate.mjs` (catalogue + layout)

- [x] Encode full file catalogue with Arabic roles from the spec
- [x] Layout four zones (Root / app / components / lib+styles) with coloured cards
- [x] Write Excalidraw JSON; parse with `JSON.parse` to verify

### Task 2: Board 2 — state / data flow

**Files:**
- Create: `docs/architecture/web-state-dataflow.excalidraw`

- [x] Five bands: boot, contexts, page I/O, error path, shell identity
- [x] Arrows between live steps; side boxes for supporting libs
- [x] Parse JSON to verify

### Task 3: README

**Files:**
- Create: `docs/architecture/README.md`

- [x] Point at both boards, how to open in Cursor Excalidraw, link to the spec / update rule (D5)

### Task 4: Verify

- [x] Both files parse; element counts cover catalogue (Board 1) and five bands (Board 2)
- [x] No `apps/web` runtime files modified
