# Dev Executions UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-only, flag-gated dev UI that lists recent workflow runs and renders any run's execution trace as an interactive Mermaid flowchart, with click-to-inspect step input/output.

**Architecture:** A new app module `src/app/dev/` (controller + module + an HTML page exported as a TS string) injects the engine's existing `ExecutionStore` and exposes `GET /dev`, `GET /dev/api/executions`, `GET /dev/api/executions/:id`. `AppModule` registers the module only when `appConfig.devUiEnabled` is true, so the routes don't exist in production. The page uses Tailwind Play CDN + Mermaid CDN — no npm deps, no build.

**Tech Stack:** TypeScript (nodenext/CommonJS), NestJS 11 (Express), Jest. Frontend: Tailwind Play CDN, Mermaid 11 ESM CDN, vanilla JS.

**Spec:** `docs/superpowers/specs/2026-06-06-dev-executions-ui-design.md`

---

## File Structure

- **Modify** `src/app/config.ts` — add `devUiEnabled: boolean` from `DEV_UI_ENABLED`.
- **Create** `src/app/dev/dev-ui.page.ts` — `DEV_UI_PAGE` HTML string (Tailwind + Mermaid + JS).
- **Create** `src/app/dev/dev.controller.ts` — `DevController` (page + JSON API), injects `ExecutionStore`.
- **Create** `src/app/dev/dev.module.ts` — `DevModule` (imports `EngineModule`) + `devUiImports(enabled)` helper.
- **Create** `src/app/dev/dev.controller.spec.ts` — controller unit tests.
- **Create** `src/app/dev/dev.module.spec.ts` — `devUiImports` gating test.
- **Modify** `src/app.module.ts` — spread `devUiImports(appConfig.devUiEnabled)` into `imports`.
- **Modify** `CLAUDE.md` — document `DEV_UI_ENABLED`.

---

## Task 1: Config flag

**Files:**
- Modify: `src/app/config.ts`
- Test: `src/app/config.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/app/config.spec.ts`:

```typescript
import { appConfig } from './config';

describe('appConfig', () => {
  it('exposes devUiEnabled as a boolean reflecting DEV_UI_ENABLED', () => {
    expect(typeof appConfig.devUiEnabled).toBe('boolean');
    expect(appConfig.devUiEnabled).toBe(process.env.DEV_UI_ENABLED === 'true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- config.spec`
Expected: FAIL — `devUiEnabled` is `undefined`, `typeof` is `"undefined"`.

- [ ] **Step 3: Add the field**

In `src/app/config.ts`, add `devUiEnabled: boolean;` to the `AppConfig` type (after `queueConcurrency: number;`):

```typescript
export type AppConfig = {
  id: string;
  telegramBotToken: string;
  openRouterApiKey: string;
  openRouterModel: string;
  geminiApiKey: string;
  geminiModel: string;
  redisUrl: string;
  queueConcurrency: number;
  devUiEnabled: boolean;
};
```

And add the value to the `appConfig` object (after `queueConcurrency`):

```typescript
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY) || 5,
  devUiEnabled: process.env.DEV_UI_ENABLED === 'true',
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- config.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/config.ts src/app/config.spec.ts
git commit -m "feat(app): add devUiEnabled config flag"
```

---

## Task 2: Dev page, controller, and module

**Files:**
- Create: `src/app/dev/dev-ui.page.ts`
- Create: `src/app/dev/dev.controller.ts`
- Create: `src/app/dev/dev.module.ts`
- Test: `src/app/dev/dev.controller.spec.ts`

- [ ] **Step 1: Create the HTML page constant**

Create `src/app/dev/dev-ui.page.ts`. This is static — no test of its own; Task 2's controller test only checks the `GET /dev` route returns it (asserting a title marker).

```typescript
// Self-contained dev UI page: Tailwind Play CDN + Mermaid 11 ESM + vanilla JS.
// Served verbatim by DevController at GET /dev. No build step, no npm deps.
export const DEV_UI_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Neuron Dev — Executions</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-50 text-slate-800">
<div class="flex h-screen">
  <aside class="w-96 shrink-0 border-r border-slate-200 overflow-y-auto">
    <h1 class="p-4 text-lg font-semibold">Executions</h1>
    <table class="w-full text-sm">
      <thead class="text-left text-slate-500"><tr>
        <th class="px-3 py-2">#</th><th>workflow</th><th>status</th><th>ms</th><th>tok</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </aside>
  <main class="flex-1 flex flex-col overflow-hidden">
    <div id="chart" class="flex-1 overflow-auto p-4"></div>
    <section id="detail" class="h-1/2 border-t border-slate-200 overflow-auto p-4 text-xs font-mono whitespace-pre-wrap"></section>
  </main>
</div>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', flowchart: { useMaxWidth: false } });

const stepIndex = {};

function esc(s){ return String(s).replace(/"/g, '&quot;').replace(/\\n/g, ' '); }

function walk(step, id, parentId, lines){
  stepIndex[id] = step;
  const dur = (step.finishedAt && step.startedAt) ? (step.finishedAt - step.startedAt) : 0;
  lines.push(id + '["' + esc(step.name + ' [' + step.kind + '] ' + dur + 'ms') + '"]');
  if (parentId) lines.push(parentId + ' --> ' + id);
  lines.push('class ' + id + ' ' + (step.status === 'error' ? 'err' : 'ok'));
  lines.push('click ' + id + ' call showStep("' + id + '")');
  let kids = [];
  if (step.kind === 'node') kids = step.children || [];
  else if (step.kind === 'subworkflow') kids = (step.trace && step.trace.steps) || [];
  kids.forEach((k, i) => walk(k, id + '_' + i, id, lines));
}

window.showStep = (id) => {
  const s = stepIndex[id];
  if (!s) return;
  const dur = (s.finishedAt && s.startedAt) ? (s.finishedAt - s.startedAt) : 0;
  const parts = [];
  parts.push('# ' + s.name + '  (' + s.kind + ', ' + s.status + ', ' + dur + 'ms)');
  if (s.usage) parts.push('tokens: ' + JSON.stringify(s.usage));
  if (s.error) parts.push('ERROR: ' + (s.error.message || ''));
  parts.push('\\nINPUT:\\n' + JSON.stringify(s.input, null, 2));
  parts.push('\\nOUTPUT:\\n' + JSON.stringify(s.output, null, 2));
  document.getElementById('detail').textContent = parts.join('\\n');
};

async function loadRun(id){
  const chart = document.getElementById('chart');
  const rec = await fetch('/dev/api/executions/' + id).then(r => r.ok ? r.json() : null);
  if (!rec){ chart.textContent = 'not found'; return; }
  for (const k in stepIndex) delete stepIndex[k];
  const t = rec.trace;
  const lines = ['flowchart TD'];
  lines.push('classDef ok fill:#dcfce7,stroke:#16a34a,color:#064e3b');
  lines.push('classDef err fill:#fee2e2,stroke:#dc2626,color:#7f1d1d');
  stepIndex['root'] = { name: t.workflowName, kind: 'workflow', status: t.status, input: t.input, output: t.output, error: t.error, startedAt: t.startedAt, finishedAt: t.finishedAt };
  lines.push('root["' + esc(t.workflowName) + '"]');
  lines.push('class root ' + (t.status === 'error' ? 'err' : 'ok'));
  lines.push('click root call showStep("root")');
  (t.steps || []).forEach((s, i) => walk(s, 's' + i, 'root', lines));
  try {
    const { svg, bindFunctions } = await mermaid.render('g' + id, lines.join('\\n'));
    chart.innerHTML = svg;
    if (bindFunctions) bindFunctions(chart);
  } catch (e) {
    chart.textContent = 'render error: ' + e.message;
  }
  showStep('root');
}

async function loadList(){
  const rows = await fetch('/dev/api/executions').then(r => r.json());
  const tbody = document.getElementById('rows');
  tbody.innerHTML = '';
  for (const r of rows){
    const tr = document.createElement('tr');
    tr.className = 'cursor-pointer hover:bg-slate-100 border-t border-slate-100';
    const color = r.status === 'error' ? 'text-red-600' : 'text-green-600';
    tr.innerHTML = '<td class="px-3 py-2">' + r.id + '</td>' +
      '<td>' + r.workflowName + '</td>' +
      '<td class="' + color + '">' + r.status + '</td>' +
      '<td>' + r.durationMs + '</td>' +
      '<td>' + r.tokensTotal + '</td>';
    tr.onclick = () => loadRun(r.id);
    tbody.appendChild(tr);
  }
}

loadList();
</script>
</body>
</html>`;
```

- [ ] **Step 2: Write the failing controller test**

Create `src/app/dev/dev.controller.spec.ts`. Tests instantiate the controller directly with a mocked `ExecutionStore` (matches the repo's tool-spec style — no TestingModule needed).

```typescript
import { NotFoundException } from '@nestjs/common';
import { DevController } from './dev.controller';
import type { ExecutionStore } from '../../engine';

function makeStore(over: Partial<ExecutionStore> = {}): ExecutionStore {
  return {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    save: jest.fn(),
    ...over,
  } as unknown as ExecutionStore;
}

describe('DevController', () => {
  it('serves the HTML page with the dev title', () => {
    const html = new DevController(makeStore()).page();
    expect(html).toContain('Neuron Dev');
  });

  it('lists executions with the default limit of 50', async () => {
    const list = jest.fn().mockResolvedValue([{ id: 1 }]);
    const c = new DevController(makeStore({ list } as Partial<ExecutionStore>));
    const out = await c.list(undefined);
    expect(list).toHaveBeenCalledWith(50);
    expect(out).toEqual([{ id: 1 }]);
  });

  it('passes a numeric limit through to the store', async () => {
    const list = jest.fn().mockResolvedValue([]);
    const c = new DevController(makeStore({ list } as Partial<ExecutionStore>));
    await c.list('10');
    expect(list).toHaveBeenCalledWith(10);
  });

  it('returns a single execution record by id', async () => {
    const record = { id: 7, workflowName: 'w' };
    const get = jest.fn().mockResolvedValue(record);
    const c = new DevController(makeStore({ get } as Partial<ExecutionStore>));
    const out = await c.get('7');
    expect(get).toHaveBeenCalledWith(7);
    expect(out).toBe(record);
  });

  it('throws NotFound when the execution is missing', async () => {
    const get = jest.fn().mockResolvedValue(null);
    const c = new DevController(makeStore({ get } as Partial<ExecutionStore>));
    await expect(c.get('999')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- dev.controller`
Expected: FAIL — `Cannot find module './dev.controller'`.

- [ ] **Step 4: Write the controller**

Create `src/app/dev/dev.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ExecutionStore,
  type ExecutionRecord,
  type ExecutionSummary,
} from '../../engine';
import { DEV_UI_PAGE } from './dev-ui.page';

@Controller('dev')
export class DevController {
  constructor(private readonly store: ExecutionStore) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return DEV_UI_PAGE;
  }

  @Get('api/executions')
  list(@Query('limit') limit?: string): Promise<ExecutionSummary[]> {
    const n = limit ? Number(limit) : 50;
    return this.store.list(Number.isFinite(n) && n > 0 ? n : 50);
  }

  @Get('api/executions/:id')
  async get(@Param('id') id: string): Promise<ExecutionRecord> {
    const record = await this.store.get(Number(id));
    if (!record) {
      throw new NotFoundException(`execution ${id} not found`);
    }
    return record;
  }
}
```

- [ ] **Step 5: Create the module**

Create `src/app/dev/dev.module.ts`. The `devUiImports` helper is what `AppModule` uses to conditionally register; it's exported for a deterministic gating test (Task 3).

```typescript
import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { EngineModule } from '../../engine';
import { DevController } from './dev.controller';

@Module({
  imports: [EngineModule],
  controllers: [DevController],
})
export class DevModule {}

// Returns the module to register only when the dev UI is enabled, so the routes
// don't exist at all in production. Spread into AppModule's `imports`.
export function devUiImports(
  enabled: boolean,
): (Type | DynamicModule)[] {
  return enabled ? [DevModule] : [];
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test -- dev.controller`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/app/dev/dev-ui.page.ts src/app/dev/dev.controller.ts src/app/dev/dev.module.ts src/app/dev/dev.controller.spec.ts
git commit -m "feat(app): add dev executions UI controller, module, and page"
```

---

## Task 3: Wire into AppModule (gated)

**Files:**
- Modify: `src/app.module.ts`
- Test: `src/app/dev/dev.module.spec.ts` (create)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the failing gating test**

Create `src/app/dev/dev.module.spec.ts`:

```typescript
import { DevModule, devUiImports } from './dev.module';

describe('devUiImports', () => {
  it('registers DevModule when enabled', () => {
    expect(devUiImports(true)).toEqual([DevModule]);
  });

  it('registers nothing when disabled', () => {
    expect(devUiImports(false)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm test -- dev.module`
Expected: PASS (2 tests). `devUiImports` already exists from Task 2 — this locks its behavior.

- [ ] **Step 3: Wire the conditional import into AppModule**

In `src/app.module.ts`, add the import near the other app imports (after the `appConfig` import):

```typescript
import { devUiImports } from './app/dev/dev.module';
```

Then spread it into the module's `imports` array:

```typescript
  imports: [
    EngineModule,
    BullModule.forRoot({ connection: redisConnection(appConfig.redisUrl) }),
    BullModule.registerQueue({ name: TELEGRAM_QUEUE }),
    ...devUiImports(appConfig.devUiEnabled),
  ],
```

- [ ] **Step 4: Verify build and full suite**

Run: `pnpm build`
Expected: succeeds.

Run: `pnpm test`
Expected: all suites PASS.

- [ ] **Step 5: Document the env key**

In `CLAUDE.md`, under the "Expected keys:" list in the Environment section, add a bullet after the `GEMINI_API_KEY` line:

```markdown
- `DEV_UI_ENABLED` — set to `true` to mount the local dev executions UI at `/dev` (lists runs, renders each trace as a flowchart). Optional; defaults off. Leave unset in production — the trace contains system prompts and customer messages.
```

- [ ] **Step 6: Commit**

```bash
git add src/app.module.ts src/app/dev/dev.module.spec.ts CLAUDE.md
git commit -m "feat(app): mount dev UI when DEV_UI_ENABLED is set"
```

---

## Self-Review

**Spec coverage:**
- App-level placement (`src/app/dev/`), engine untouched → Tasks 2 & 3. ✓
- `devUiEnabled` config from `DEV_UI_ENABLED` → Task 1. ✓
- Conditional registration (routes absent when off) → `devUiImports` + AppModule spread, Task 3. ✓
- `GET /dev` returns HTML page → Task 2 controller `page()`. ✓
- `GET /dev/api/executions?limit=` → Task 2 `list()`, default 50, numeric passthrough. ✓
- `GET /dev/api/executions/:id`, 404 on missing → Task 2 `get()`. ✓
- Trace recursion (node `children`, subworkflow `trace.steps`) → page `walk()`. ✓
- Tailwind Play CDN + Mermaid CDN + vanilla JS, no deps/build → `dev-ui.page.ts`. ✓
- Interactive flowchart, click node → in/out JSON detail → page `walk`/`showStep`/`loadRun`. ✓
- Tests: controller (mocked store) + gating; page not unit-tested → Tasks 2 & 3. ✓
- Document `DEV_UI_ENABLED` → Task 3 Step 5. ✓
- Out of scope (business UI, auth, search, live refresh, Tailwind build) → none included. ✓

**Placeholder scan:** No TBD/TODO; full code in every step including the complete HTML page and all test bodies. ✓

**Type consistency:** `ExecutionStore`, `ExecutionSummary`, `ExecutionRecord` imported from `../../engine` (verified exported in `src/engine/index.ts`). `DEV_UI_PAGE` defined in `dev-ui.page.ts`, imported in `dev.controller.ts`. `devUiImports` defined in `dev.module.ts` (Task 2), tested in Task 3, used in `app.module.ts` (Task 3). `devUiEnabled` defined Task 1, consumed Task 3. Controller methods `page()`/`list(limit?)`/`get(id)` match between spec and implementation. ✓
