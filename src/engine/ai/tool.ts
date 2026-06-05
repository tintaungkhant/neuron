export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema for the arguments object
}

export interface ToolRetry {
  count?: number; // extra attempts after the first; default 0 (no retry)
  delayMs?: number; // sleep before each retry; default 0 (no sleep)
}

export interface AgentTool extends ToolSpec {
  execute(args: Record<string, unknown>): Promise<unknown>;
  // Opt-in retry policy. Only set this on idempotent (read-only) tools — never
  // on writes like create_order, or a retry could duplicate the action.
  retry?: ToolRetry;
}
