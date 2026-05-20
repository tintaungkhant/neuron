export type DemoConfig = {
  telegramBotToken: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export const demoConfig: DemoConfig = {
  telegramBotToken: requireEnv('DEMO_TELEGRAM_BOT_TOKEN'),
};
