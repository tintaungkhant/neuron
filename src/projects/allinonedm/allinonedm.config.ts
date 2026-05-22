export type AllInOneDMConfig = {
  telegramBotToken: string;
  openRouterApiKey: string;
  openRouterModel: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export const allInOneDMConfig: AllInOneDMConfig = {
  telegramBotToken: requireEnv('ALLINONEDM_TELEGRAM_BOT_TOKEN'),
  openRouterApiKey: requireEnv('ALLINONEDM_OPENROUTER_API_KEY'),
  openRouterModel: requireEnv('ALLINONEDM_OPENROUTER_MODEL'),
};
