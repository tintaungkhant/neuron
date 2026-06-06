# Dev Executions UI — Design

**Date:** 2026-06-06
**Status:** Approved (design); spec pending user review

## Problem

The engine persists every workflow run's enriched `Trace` to the `executions` table (`ExecutionStore.save`), and `ExecutionStore` already exposes `list()` and `get(id)` — but nothing surfaces them. There is no way to look at what happened in a run: which nodes/tools fired, their inputs/outputs, durations, token usage, or where a run failed.

This is the first of two planned UIs (the other, a **business UI**, is a separate later spec). This spec covers only the **dev UI**: an internal, local-only view of execution traces.

## Goals

- Browse recent runs (workflow, status, duration, tokens, time).
- Drill into one run and see its trace as an interactive **flowchart**: workflow → nodes → tool children → sub-workflows, with per-step input/output, duration, status, and token usage.
- Zero new npm dependencies; no frontend build step.
- Keep the engine HTTP/view-free (it stays extractable). The UI is an **app** concern.

## Non-goals (out of scope)

- The business UI (separate spec).
- Authentication, filtering/search, live refresh, pagination beyond a `limit`.
- A real Tailwind build pipeline — the dev UI uses the Tailwind **Play CDN**.

## Architecture

### Placement

Per CLAUDE.md, controllers live in `src/app/` and call the engine; the engine exposes no HTTP. The dev UI is therefore an app module:

- `src/app/dev/dev.controller.ts` — the routes.
- `src/app/dev/dev.module.ts` — bundles the controller (imports `EngineModule` for `ExecutionStore`).
- `src/app/dev/dev-ui.page.ts` — the static HTML page exported as a TS template-string constant (no asset-copy config; survives `nest build`).

`ExecutionStore` is already a DI provider exported by `EngineModule`; the controller injects it unchanged. No engine changes.

### Conditional registration (gating)

The dev UI is gated by a config flag so it never exists in production:

- Add `devUiEnabled: boolean` to `appConfig` (`src/app/config.ts`), read from `DEV_UI_ENABLED === 'true'` (optional env; default `false`).
- `AppModule` includes `DevModule` in its `imports` **only when** `appConfig.devUiEnabled` is true. When the flag is off, the routes are not registered at all (safer than a runtime guard returning 403/404).

Document `DEV_UI_ENABLED` in CLAUDE.md's env section.

## Endpoints

All under `/dev`, served by `DevController`:

| Method | Path | Returns |
|--------|------|---------|
| GET | `/dev` | The HTML page (`Content-Type: text/html`), from the `dev-ui.page.ts` constant. |
| GET | `/dev/api/executions?limit=50` | `ExecutionStore.list(limit)` — array of `ExecutionSummary`. `limit` parsed to a number, default 50. |
| GET | `/dev/api/executions/:id` | `ExecutionStore.get(id)` — `ExecutionRecord`; **404** when null or id is not a positive integer. |

The controller is thin: parse params, delegate to `ExecutionStore`, map a missing record to `NotFoundException`.

## Trace data the UI renders

`ExecutionRecord.trace` is the enriched, truncated `Trace`. Shapes the flowchart must walk (from `src/engine/trace.ts`):

- `Trace`: `{ workflowName, status, startedAt, finishedAt, input, output?, error?, steps: TraceStep[] }`.
- `TraceStep` is one of three `kind`s:
  - `node` — `{ name, input, output?, status, startedAt, finishedAt, error?, children?: TraceStep[], usage? }`. `children` are the tool calls folded in by `enrichTrace`.
  - `tool` — `{ name, input, output?, status, startedAt, finishedAt, error? }`. Leaf.
  - `subworkflow` — `{ name, input, output?, status, startedAt, finishedAt, error?, trace: Trace, usage? }`. Recurse into `trace.steps`.

So the flowchart is a recursive walk: workflow root → its `steps` in order; a `node` expands into its `children`; a `subworkflow` expands into its nested `trace`'s steps.

## Frontend page (`dev-ui.page.ts`)

One self-contained HTML string. No build, no framework.

- **Head:** Tailwind Play CDN (`<script src="https://cdn.tailwindcss.com">`) and Mermaid CDN (`<script type="module">import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@.../dist/mermaid.esm.min.mjs'</script>` or the UMD build), `mermaid.initialize({ startOnLoad: false })`.
- **Layout (Tailwind):** left column = run list; right column = flowchart + a detail panel.
- **Run list:** on load, `fetch('/dev/api/executions')` → render a table (id, workflowName, status, durationMs, tokensTotal, createdAt). Status colored (ok=green, error=red). Click a row → load that run.
- **Flowchart:** on row click, `fetch('/dev/api/executions/:id')` → build a Mermaid `flowchart TD` definition by recursively walking the trace (root node = workflowName; one node per step; sequential edges; `node` children and `subworkflow` steps nested under their parent). Color nodes by status. Render via `mermaid.render`.
- **Interactivity:** each Mermaid node maps to a step; clicking a node shows that step's **input** and **output** (pretty-printed JSON), plus `durationMs`, `status`, `error` (if any), and `usage` (if present) in the detail panel. Implemented with Mermaid `click` callbacks (or a parallel clickable index keyed by a generated step id) — the plan picks the exact mechanism.
- A small JS helper assigns each step a stable id during the walk (e.g. `s0`, `s0_1`) used both as the Mermaid node id and the detail-lookup key.

## Error handling

- Unknown/missing execution id → 404 from the API; the page shows a "not found" message.
- `ExecutionStore` throws (DB error) → standard Nest 500; the page shows a generic load-error message.
- Truncated traces (`truncateTrace` replaces oversized in/out with a marker string) render as-is — the UI just displays whatever the stored trace contains.

## Testing (no live runs)

Per project rule, unit/integration only — no `start:dev`.

- `dev.controller.spec.ts` with a mocked `ExecutionStore`:
  - `GET /dev/api/executions` returns the list and passes `limit` through.
  - `GET /dev/api/executions/:id` returns the record.
  - missing id (store returns null) → 404.
  - `GET /dev` returns HTML containing a known marker (e.g. the page title).
- Gating: a spec asserting `DevModule` is absent from the app when `DEV_UI_ENABLED` is unset/false, and present when true. (Test by constructing the module list the way `AppModule` does, or via a small exported helper that returns the conditional imports.)
- The HTML/JS page itself is static and not unit-tested.

## Files

- **Create** `src/app/dev/dev.controller.ts` — routes, injects `ExecutionStore`.
- **Create** `src/app/dev/dev.module.ts` — `DevModule` (imports `EngineModule`).
- **Create** `src/app/dev/dev-ui.page.ts` — exported HTML string.
- **Create** `src/app/dev/dev.controller.spec.ts` — controller tests.
- **Modify** `src/app/config.ts` — add `devUiEnabled` (reads `DEV_UI_ENABLED`).
- **Modify** `src/app.module.ts` — conditionally include `DevModule`.
- **Modify** `CLAUDE.md` — document `DEV_UI_ENABLED`.

## Effect

A developer sets `DEV_UI_ENABLED=true`, starts the app, opens `/dev`, and can browse recent runs and inspect any trace as an interactive flowchart — without touching the DB. Off by default, so production is unaffected and no engine code changes.
