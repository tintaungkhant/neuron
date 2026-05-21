export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema for the arguments object
}

export interface AgentTool extends ToolSpec {
  execute(args: Record<string, unknown>): Promise<unknown>;
}
