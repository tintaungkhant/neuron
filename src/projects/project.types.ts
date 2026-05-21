export type WorkflowInput<TConfig, TPayload> = {
  project: { id: string; config: TConfig };
  payload: TPayload;
};
