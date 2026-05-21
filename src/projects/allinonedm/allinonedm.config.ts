export type AllInOneDMConfig = {
    telegramBotToken: string;
  };
  
  function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`missing env ${name}`);
    return v;
  }
  
  export const allInOneDMConfig: AllInOneDMConfig = {
    telegramBotToken: requireEnv('ALLINONEDM_TELEGRAM_BOT_TOKEN'),
  };
  