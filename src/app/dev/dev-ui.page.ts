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
