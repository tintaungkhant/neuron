import { TelegramInNode } from './telegram-in.node';

describe('TelegramInNode', () => {
  it('parses chatId and text from a Telegram update', async () => {
    const node = new TelegramInNode();
    const out = await node.execute({
      message: { chat: { id: 42 }, text: 'hello' },
    });
    expect(out).toEqual({ chatId: 42, text: 'hello' });
  });

  it('returns chatId 0 and empty text when message is missing', async () => {
    const node = new TelegramInNode();
    const out = await node.execute({});
    expect(out).toEqual({ chatId: 0, text: '' });
  });

  it('returns chatId from chat and empty text when text is missing', async () => {
    const node = new TelegramInNode();
    const out = await node.execute({ message: { chat: { id: 7 } } });
    expect(out).toEqual({ chatId: 7, text: '' });
  });
});
