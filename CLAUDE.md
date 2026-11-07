# Smile Sim — agent guide

Wholesale SIM-card office, RTL-first (ar / en / he). Four layers ("doors"), resolved from the host name: branch (`admin.`), main agent (`main.`), agent (`agent.`), point of sale (`pos.`). Business rules: `docs/project-plan.md` (Arabic, dated sections).

## Read these instead of the source

| Need | File |
|---|---|
| Backend modules, endpoints, patterns, data model | `docs/architecture/backend.md` |
| Frontend routes, data flow, components, known defects | `docs/architecture/frontend.md` |
| Visual system (tokens, stylesheets, components) | `DESIGN.md` |
| Current refactor plan and its status | `docs/superpowers/plans/2026-11-08-architecture-refactor.md` |
| Decisions and why | `docs/architecture/decisions/` |
| Work rules (spec → plan → slice, language, push, UI) | `.cursor/rules/*.mdc` — they apply to Claude too |

Open source files only for the area you are changing. If a map is wrong, fix the map in the same change.

## graphify — file and symbol relationships

A knowledge graph of the code (`apps/`) and the core docs lives in `graphify-out/` (git-ignored, local). Scope is set by `.graphifyignore`. CLI: `~/.venvs/graphify/bin/graphify` (Python 3.12 venv).

- Before reading code to find who calls what, what a change touches, or how two parts connect, ask the graph:
  `graphify query "<question>"` · `graphify path "A" "B"` · `graphify explain "Symbol"`. Cite `source_location` from the answer, then open only those files.
- `graphify-out/GRAPH_REPORT.md` lists god nodes, communities and surprising links. Read it at the start of a refactor slice.
- Git hooks (post-commit, post-checkout, post-merge, post-rewrite) rebuild the code graph automatically after each commit (AST only, no LLM cost). For uncommitted work, refresh by hand: `graphify update .`. After editing a core doc (`CLAUDE.md`, `DESIGN.md`, `docs/architecture/*.md`, `docs/project-plan.md`), run `/graphify . --update` so the doc nodes are re-extracted.
- The graph shows structure; the codemaps explain intent. Keep both current.

## Keep the maps current

A change is not done until the matching doc says what the code now does:

- New/removed/renamed module, endpoint group, model, guard, or shared helper → `docs/architecture/backend.md`.
- New/removed route, shared component, hook, context, or data-flow change → `docs/architecture/frontend.md` (and the Excalidraw boards via `node docs/architecture/generate.mjs` when file roles change).
- New token, stylesheet, or primitive → `DESIGN.md`.
- A refactor slice finished → tick it in the plan file with the commit hash.
- A choice between real alternatives → a short ADR in `docs/architecture/decisions/NNNN-<slug>.md`.
- Bump the "Last verified" line of a map you edited.

## Commands (repo root)

```
npm run lint          npm run typecheck      npm run check:copy
npm run test:api      npm run test:e2e       npm run build
docker compose up --build    # web :3000, api :3001, worker, postgres, redis
```
CI (`.github/workflows/ci.yml`) runs lint, check:copy, typecheck, test:api, build. Run them before a push (`.cursor/rules/after-push.mdc`).

## Conventions

- Chat replies in Arabic; specs, plans, docs, code, commits in English (`.cursor/rules/chat-language.mdc`).
- Spec + plan in `docs/superpowers/{specs,plans}/` before any behaviour, money, status, navigation, or layout change (`work-plan.mdc`). One verified slice at a time.
- Refactors are behaviour-preserving: same endpoint paths, same response shapes (`response-shape.spec.ts`), same UI unless the slice says otherwise.
- Money is integer agorot. Never write an absolute balance computed from a prior read.
- UI: tokens only (`--rd-*`), logical properties only, check ar + en, light + dark.
- `apps/api/src/generated/` is Prisma output — never edit.
