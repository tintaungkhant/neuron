import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule', () => {
  const ORIGINAL_TOKEN = process.env.DEMO_TELEGRAM_BOT_TOKEN;

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.DEMO_TELEGRAM_BOT_TOKEN;
    } else {
      process.env.DEMO_TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
    }
    jest.resetModules();
  });

  it('boots when DEMO_TELEGRAM_BOT_TOKEN is set', async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await mod.close();
  });

  it('throws when DEMO_TELEGRAM_BOT_TOKEN is missing on (re-)import', () => {
    delete process.env.DEMO_TELEGRAM_BOT_TOKEN;
    jest.resetModules();
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./app.module');
    }).toThrow(/missing env DEMO_TELEGRAM_BOT_TOKEN/);
  });
});
