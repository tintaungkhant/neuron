import type { WorkflowFn } from '../engine';

export type ProjectId = string;

export type TelegramUpdate = {
  message?: { chat: { id: number }; text?: string };
};

export type TriggerInput<TConfig, TPayload> = {
  project: { id: ProjectId; config: TConfig };
  payload: TPayload;
};

export type ProjectWorkflows<TConfig> = {
  telegram?: WorkflowFn<TriggerInput<TConfig, TelegramUpdate>, void>;
};

export interface Project<TConfig = unknown> {
  id: ProjectId;
  config: TConfig;
  workflows: ProjectWorkflows<TConfig>;
}
