// Self-contained dev UI page: Tailwind Play CDN + vanilla JS. Renders an
// execution trace as a card flow — a horizontal spine of step cards in
// execution order, with each node's tool calls / sub-workflow steps dropping
// into a vertical branch beneath it. No build step, no npm deps.
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
  <aside class="w-80 shrink-0 border-r border-slate-200 overflow-y-auto">
    <h1 class="p-4 text-lg font-semibold">Executions</h1>
    <table class="w-full text-sm">
      <thead class="text-left text-slate-500"><tr>
        <th class="px-3 py-2">#</th><th>workflow</th><th>status</th><th>ms</th><th>tok</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </aside>
  <main class="flex-1 flex flex-col overflow-hidden">
    <div id="chart" class="flex-1 overflow-auto p-6"></div>
    <section id="detail" class="h-1/2 border-t border-slate-200 overflow-auto p-4 text-xs font-mono whitespace-pre-wrap bg-slate-900 text-slate-100"></section>
  </main>
</div>
<script>
const stepIndex = {};
let selectedEl = null;

function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function durOf(s){ return (s.finishedAt && s.startedAt) ? (s.finishedAt - s.startedAt) : 0; }
function kidsOf(step){
  if (step.kind === 'node') return step.children || [];
  if (step.kind === 'subworkflow') return (step.trace && step.trace.steps) || [];
  return [];
}

function card(id, step){
  const ok = step.status !== 'error';
  const el = document.createElement('div');
  el.id = 'card-' + id;
  el.className = 'cursor-pointer select-none rounded-xl border bg-white px-3 py-2 shadow-sm transition hover:shadow-md min-w-[150px] max-w-[230px] ' +
    (ok ? 'border-emerald-300' : 'border-red-300 bg-red-50');
  el.innerHTML =
    '<div class="text-[10px] font-semibold uppercase tracking-wide ' + (ok ? 'text-emerald-600' : 'text-red-600') + '">' + escHtml(step.kind) + '</div>' +
    '<div class="font-medium text-sm text-slate-800 truncate">' + escHtml(step.name) + '</div>' +
    '<div class="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">' +
      '<span class="rounded bg-slate-100 px-1.5 py-0.5">' + durOf(step) + 'ms</span>' +
      (step.usage ? '<span class="rounded bg-indigo-50 text-indigo-600 px-1.5 py-0.5">' + (step.usage.totalTokens || 0) + ' tok</span>' : '') +
    '</div>';
  el.onclick = () => selectStep(id, el);
  return el;
}

function arrow(){
  const a = document.createElement('div');
  a.className = 'self-center text-slate-300 text-2xl px-1 shrink-0';
  a.textContent = '→';
  return a;
}

function downArrow(){
  const d = document.createElement('div');
  d.className = 'text-slate-300 text-sm leading-none pl-1';
  d.textContent = '↓';
  return d;
}

// One spine cell: the card and its to-next arrow sit in a top row (so all
// arrows align to the card line regardless of how tall the branch below is);
// the node's tool calls / sub-workflow steps drop into a vertical branch under
// the card.
function makeCell(id, step, isLast){
  stepIndex[id] = step;
  const cell = document.createElement('div');
  cell.className = 'flex flex-col gap-2';
  const top = document.createElement('div');
  top.className = 'flex flex-row items-center gap-1';
  top.appendChild(card(id, step));
  if (!isLast) top.appendChild(arrow());
  cell.appendChild(top);
  const kids = kidsOf(step);
  if (kids.length){
    const sub = document.createElement('div');
    sub.className = 'ml-3 border-l-2 border-slate-200 pl-3 flex flex-col gap-1';
    renderBranch(kids, sub, id + '_');
    cell.appendChild(sub);
  }
  return cell;
}

// Branch (tool calls / sub-workflow steps): stacked vertically in run order.
function renderBranch(steps, container, prefix){
  steps.forEach((step, i) => {
    const id = prefix + i;
    stepIndex[id] = step;
    if (i > 0) container.appendChild(downArrow());
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-1';
    wrap.appendChild(card(id, step));
    const kids = kidsOf(step);
    if (kids.length){
      const sub = document.createElement('div');
      sub.className = 'ml-3 border-l-2 border-slate-200 pl-3 flex flex-col gap-1';
      renderBranch(kids, sub, id + '_');
      wrap.appendChild(sub);
    }
    container.appendChild(wrap);
  });
}

function selectStep(id, el){
  if (selectedEl) selectedEl.classList.remove('ring-2','ring-blue-500');
  if (el){ el.classList.add('ring-2','ring-blue-500'); selectedEl = el; }
  const s = stepIndex[id];
  if (!s){ return; }
  const parts = [];
  parts.push('# ' + s.name + '  (' + s.kind + ', ' + s.status + ', ' + durOf(s) + 'ms)');
  if (s.usage) parts.push('tokens: ' + JSON.stringify(s.usage));
  if (s.error) parts.push('ERROR: ' + (s.error.message || ''));
  parts.push('\\nINPUT:\\n' + JSON.stringify(s.input, null, 2));
  parts.push('\\nOUTPUT:\\n' + JSON.stringify(s.output, null, 2));
  document.getElementById('detail').textContent = parts.join('\\n');
}

async function loadRun(id){
  const chart = document.getElementById('chart');
  const rec = await fetch('/dev/api/executions/' + id).then(r => r.ok ? r.json() : null);
  if (!rec){ chart.textContent = 'not found'; return; }
  for (const k in stepIndex) delete stepIndex[k];
  selectedEl = null;
  chart.innerHTML = '';
  const t = rec.trace;
  stepIndex['root'] = { name: t.workflowName, kind: 'workflow', status: t.status, input: t.input, output: t.output, error: t.error, startedAt: t.startedAt, finishedAt: t.finishedAt };
  const spine = document.createElement('div');
  spine.className = 'flex flex-row items-start gap-1 w-max';
  const all = [{ id: 'root', step: stepIndex['root'] }];
  (t.steps || []).forEach((s, i) => all.push({ id: 's' + i, step: s }));
  all.forEach((e, idx) => {
    spine.appendChild(makeCell(e.id, e.step, idx === all.length - 1));
  });
  chart.appendChild(spine);
  selectStep('root', document.getElementById('card-root'));
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
      '<td>' + escHtml(r.workflowName) + '</td>' +
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
