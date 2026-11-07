# 0005 — graphify knowledge graph as the code reference

Date: 2026-11-08 · Status: accepted (owner)

## Context
Small edits required re-reading large parts of the codebase to find callers and dependencies.

## Decision
A graphify graph of `apps/` plus the core docs lives in `graphify-out/` (git-ignored; scope in `.graphifyignore`). Agents query it (`graphify query|path|explain`) before reading code. Git hooks rebuild the code graph after every commit; doc changes need `/graphify . --update`.

## Consequences
- Structure (graph) and intent (codemaps in `docs/architecture/`) are both kept current.
- The CLI runs from a Python 3.12 venv at `~/.venvs/graphify` because the system Python is 3.9.
