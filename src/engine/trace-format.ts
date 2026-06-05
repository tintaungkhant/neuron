import type { Trace } from './trace';

interface FlowToken {
  label: string;
  ms: number | null; // null for surfaced tool calls (not timed as steps)
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

function hasToolCalls(o: unknown): o is { toolCalls: string[] } {
  if (typeof o !== 'object' || o === null) return false;
  const tc = (o as { toolCalls?: unknown }).toolCalls;
  return Array.isArray(tc) && tc.every((x) => typeof x === 'string');
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
    if (hasToolCalls(step.output)) {
      for (const name of step.output.toolCalls) {
        tokens.push({ label: humanize(name), ms: null, status: 'ok' });
      }
    }
  }
  return tokens;
}

/**
 * Render a Trace as a one-glance n8n-style flow line:
 *   demoTelegramHiWorkflow ✓ 1200ms
 *     telegram webhook (2ms) → ai agent (1098ms) → get services → telegram send message (100ms)
 * The trace only holds steps that ran, so a mid-flow failure shows the partial
 * path up to (and marking) the step that broke, with the reason appended.
 */
export function formatTrace(trace: Trace): string {
  const flow = collect(trace)
    .map((t) => {
      const mark = t.status === 'error' ? ' ✗' : '';
      const ms = t.ms != null ? ` (${t.ms}ms)` : '';
      return `${t.label}${mark}${ms}`;
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
