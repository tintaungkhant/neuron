export type DemoConfig = {
  id: string;
  telegramBotToken: string;
  openRouterApiKey: string;
  openRouterModel: string;
  databaseUrl: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export const demoConfig: DemoConfig = {
  id: 'demo',
  telegramBotToken: requireEnv('DEMO_TELEGRAM_BOT_TOKEN'),
  openRouterApiKey: requireEnv('DEMO_OPENROUTER_API_KEY'),
  openRouterModel: requireEnv('DEMO_OPENROUTER_MODEL'),
  databaseUrl: requireEnv('DEMO_DATABASE_URL'),
};
