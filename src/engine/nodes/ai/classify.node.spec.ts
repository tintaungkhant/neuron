import { ClassifyNode, type ClassifyOption } from './classify.node';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatModel,
} from '../../ai/chat-model';

class FakeChatModel implements ChatModel {
  readonly calls: ChatCompletionRequest[] = [];
  constructor(private readonly content: string) {}
  complete(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.calls.push(req);
    return Promise.resolve({
      message: { role: 'assistant', content: this.content },
    });
  }
}

const OPTIONS: ClassifyOption[] = [
  { label: 'discovery', description: 'new or broad' },
  { label: 'recommend', description: 'ready for suggestions' },
  { label: 'close', description: 'confirming the order' },
];

describe('ClassifyNode', () => {
  it('returns the label when the model replies with exactly a label', async () => {
    const out = await new ClassifyNode().execute({
      input: 'sounds good, go ahead',
      options: OPTIONS,
      chatModel: new FakeChatModel('close'),
    });
    expect(out.label).toBe('close');
  });

  it('matches case-insensitively and inside surrounding text', async () => {
    const out = await new ClassifyNode().execute({
      input: 'x',
      options: OPTIONS,
      chatModel: new FakeChatModel('Label: RECOMMEND'),
    });
    expect(out.label).toBe('recommend');
  });

  it('falls back to the first option when the reply matches nothing', async () => {
    const out = await new ClassifyNode().execute({
      input: 'x',
      options: OPTIONS,
      chatModel: new FakeChatModel('I am not sure'),
    });
    expect(out.label).toBe('discovery');
  });

  it('includes the labels, the input, and recent history in the prompt', async () => {
    const model = new FakeChatModel('discovery');
    await new ClassifyNode().execute({
      input: 'HELLO-INPUT',
      history: [
        { role: 'user', content: 'OLD-MSG' },
        { role: 'assistant', content: 'PRIOR-REPLY' },
      ],
      options: OPTIONS,
      chatModel: model,
    });
    const sent = model.calls[0].messages[0].content;
    expect(sent).toContain('discovery');
    expect(sent).toContain('recommend');
    expect(sent).toContain('HELLO-INPUT');
    expect(sent).toContain('OLD-MSG');
    expect(sent).toContain('PRIOR-REPLY');
  });

  it('keeps only the last historyWindow messages', async () => {
    const model = new FakeChatModel('discovery');
    await new ClassifyNode().execute({
      input: 'x',
      history: [
        { role: 'user', content: 'TOO-OLD' },
        { role: 'assistant', content: 'KEEP-1' },
        { role: 'user', content: 'KEEP-2' },
      ],
      options: OPTIONS,
      chatModel: model,
      historyWindow: 2,
    });
    const sent = model.calls[0].messages[0].content;
    expect(sent).not.toContain('TOO-OLD');
    expect(sent).toContain('KEEP-1');
    expect(sent).toContain('KEEP-2');
  });

  it('throws when options is empty', async () => {
    await expect(
      new ClassifyNode().execute({
        input: 'x',
        options: [],
        chatModel: new FakeChatModel('anything'),
      }),
    ).rejects.toThrow(/options/i);
  });
});
