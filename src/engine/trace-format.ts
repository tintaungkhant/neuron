import type { Trace, TraceStep } from './trace';

interface FlowToken {
  label: string;
  ms: number;
  status: 'ok' | 'error';
}

/** "TelegramWebhookNode" → "telegram webhook", "get_services" → "get services". */
function humanize(name: string): string {
  let s = name.replace(/Node$/, '');
  if (s.includes('_')) {
    s = s.replace(/_/g, ' ');
  } else {
    s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  }
  return s.toLowerCase().trim();
}

interface RawToolStep {
  name: string;
  input: unknown;
  output: unknown;
  startedAt: number;
  finishedAt: number;
  status: 'ok' | 'error';
}

function extractToolSteps(output: unknown): RawToolStep[] | undefined {
  if (typeof output !== 'object' || output === null) return undefined;
  const ts = (output as { toolSteps?: unknown }).toolSteps;
  if (!Array.isArray(ts)) return undefined;
  return ts as RawToolStep[];
}

/**
 * Fold node-internal tool steps (exposed on a node's output as `toolSteps`)
 * into that step's `children`, recursing into sub-workflows. Produces the
 * canonical, persistable trace where tools are first-class nested steps.
 */
export function enrichTrace(trace: Trace): Trace {
  return { ...trace, steps: trace.steps.map(enrichStep) };
}

function enrichStep(step: TraceStep): TraceStep {
  if (step.kind === 'subworkflow') {
    return { ...step, trace: enrichTrace(step.trace) };
  }
  if (step.kind === 'tool') return step;
  const tools = extractToolSteps(step.output);
  if (!tools) return step;
  const children: TraceStep[] = tools.map((t) => ({
    kind: 'tool',
    name: t.name,
    input: t.input,
    output: t.output,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
    status: t.status,
  }));
  // Drop the now-duplicated toolSteps from the node output — they live in
  // `children` after folding, no need to store them twice.
  return { ...step, output: stripToolSteps(step.output), children };
}

function stripToolSteps(output: unknown): unknown {
  if (typeof output !== 'object' || output === null) return output;
  if (!('toolSteps' in output)) return output;
  const rest = { ...(output as Record<string, unknown>) };
  delete rest.toolSteps;
  return rest;
}

const MAX_TRACE_STRING = 4000;

function truncateValue(value: unknown, max: number): unknown {
  if (typeof value === 'string') {
    return value.length > max
      ? `${value.slice(0, max)}…[+${value.length - max} chars]`
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => truncateValue(v, max));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = truncateValue(v, max);
    return out;
  }
  return value;
}

function truncateStep(step: TraceStep, max: number): TraceStep {
  const base = {
    ...step,
    input: truncateValue(step.input, max),
    output: truncateValue(step.output, max),
  };
  if (base.kind === 'subworkflow') {
    return { ...base, trace: truncateTrace(base.trace, max) };
  }
  if (base.kind === 'node' && base.children) {
    return {
      ...base,
      children: base.children.map((c) => truncateStep(c, max)),
    };
  }
  return base;
}

/**
 * Bound the size of a persisted trace by truncating long strings (system
 * prompts, big tool outputs) in every step's input/output. Keeps `executions`
 * rows from ballooning while preserving structure and timings.
 */
export function truncateTrace(trace: Trace, max = MAX_TRACE_STRING): Trace {
  return {
    ...trace,
    input: truncateValue(trace.input, max),
    output: truncateValue(trace.output, max),
    steps: trace.steps.map((s) => truncateStep(s, max)),
  };
}

/** Total executed steps, recursive: nodes + their tool children + every sub-workflow step. */
export function countSteps(trace: Trace): number {
  let n = 0;
  for (const step of trace.steps) {
    n += 1;
    if (step.kind === 'subworkflow') {
      n += countSteps(step.trace);
    } else if (step.kind === 'node' && step.children) {
      n += step.children.length;
    }
  }
  return n;
}

function collect(trace: Trace): FlowToken[] {
  const tokens: FlowToken[] = [];
  for (const step of trace.steps) {
    if (step.kind === 'subworkflow') {
      tokens.push(...collect(step.trace));
      continue;
    }
    tokens.push({
      label: humanize(step.name),
      ms: step.finishedAt - step.startedAt,
      status: step.status,
    });
    if (step.kind === 'node' && step.children) {
      for (const child of step.children) {
        tokens.push({
          label: humanize(child.name),
          ms: child.finishedAt - child.startedAt,
          status: child.status,
        });
      }
    }
  }
  return tokens;
}

/**
 * Render a Trace as a one-glance n8n-style flow line. Walks `children`
 * (tool steps), so enrich the trace first to see tools:
 *   demoTelegramHiWorkflow ✓ 1200ms
 *     telegram webhook (2ms) → ai agent (1098ms) → get services (40ms) → telegram send message (100ms)
 * The trace only holds steps that ran, so a mid-flow failure shows the partial
 * path up to (and marking) the step that broke, with the reason appended.
 */
export function formatTrace(trace: Trace): string {
  const flow = collect(trace)
    .map((t) => {
      const mark = t.status === 'error' ? ' ✗' : '';
      return `${t.label}${mark} (${t.ms}ms)`;
    })
    .join(' → ');

  const icon = trace.status === 'error' ? '✗' : '✓';
  const total = trace.finishedAt - trace.startedAt;
  let out = `${trace.workflowName} ${icon} ${total}ms\n  ${flow}`;
  if (trace.error) {
    out += `\n  └ ${trace.error.message}`;
  }
  return out;
}
