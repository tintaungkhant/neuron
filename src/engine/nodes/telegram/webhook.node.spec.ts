import { TelegramInNode } from './webhook.node';

describe('TelegramInNode', () => {
  const node = new TelegramInNode();

  it('parses a text message into the normalized output', async () => {
    const out = await node.execute({
      update_id: 100,
      message: {
        message_id: 5,
        from: { id: 7, is_bot: false, first_name: 'Tin' },
        chat: { id: 42, type: 'private' },
        date: 1700000000,
        text: 'hello',
      },
    });

    expect(out.updateId).toBe(100);
    expect(out.messageId).toBe(5);
    expect(out.chat).toMatchObject({ id: 42, type: 'private' });
    expect(out.from).toMatchObject({ id: 7, isBot: false, firstName: 'Tin' });
    expect(out.date).toEqual(new Date(1700000000 * 1000));
    expect(out.text).toBe('hello');
    expect(out.attachment).toBeUndefined();
  });

  it('falls back to caption when text is absent', async () => {
    const out = await node.execute({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 1, type: 'private' },
        date: 1,
        caption: 'a caption',
      },
    });

    expect(out.text).toBe('a caption');
  });

  it('normalizes a photo attachment and picks the largest size', async () => {
    const out = await node.execute({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 1, type: 'private' },
        date: 1,
        photo: [
          { file_id: 'small', file_unique_id: 'us', width: 90, height: 90 },
          { file_id: 'big', file_unique_id: 'ub', width: 1280, height: 1280 },
        ],
      },
    });

    expect(out.attachment).toMatchObject({ kind: 'photo', fileId: 'big' });
  });

  it('throws when the update carries no message', () => {
    expect(() => node.execute({ update_id: 1 })).toThrow(/no message/);
  });
});
