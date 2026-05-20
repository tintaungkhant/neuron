import type { Project } from '../project.types';
import { demoConfig, type DemoConfig } from './demo.config';
import { demoTelegramHiWf } from './workflows/telegram-hi.workflow';

export const demoProject: Project<DemoConfig> = {
  id: 'demo',
  config: demoConfig,
  workflows: {
    telegram: demoTelegramHiWf,
  },
};
