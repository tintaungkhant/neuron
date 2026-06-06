export type AppConfig = {
  id: string;
  telegramBotToken: string;
  openRouterApiKey: string;
  openRouterModel: string;
  geminiApiKey: string;
  geminiModel: string;
  redisUrl: string;
  queueConcurrency: number;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export const appConfig: AppConfig = {
  id: 'app',
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  openRouterApiKey: requireEnv('OPENROUTER_API_KEY'),
  openRouterModel: requireEnv('OPENROUTER_MODEL'),
  geminiApiKey: requireEnv('GEMINI_API_KEY'),
  geminiModel: requireEnv('GEMINI_MODEL'),
  redisUrl: requireEnv('REDIS_URL'),
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY) || 5,
};
