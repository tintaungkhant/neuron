import { ChunkMessageNode } from './chunk-message.node';
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

describe('ChunkMessageNode', () => {
  it('returns the parsed JSON array of strings', async () => {
    const model = new FakeChatModel('["one", "two", "three"]');
    const out = await new ChunkMessageNode().execute({
      text: 'long text',
      chatModel: model,
    });
    expect(out.chunks).toEqual(['one', 'two', 'three']);
  });

  it('extracts the array from surrounding prose / code fences', async () => {
    const model = new FakeChatModel('Sure:\n```json\n["a", "b"]\n```');
    const out = await new ChunkMessageNode().execute({
      text: 't',
      chatModel: model,
    });
    expect(out.chunks).toEqual(['a', 'b']);
  });

  it('falls back to [text] when the content is not JSON', async () => {
    const model = new FakeChatModel('I cannot do that');
    const out = await new ChunkMessageNode().execute({
      text: 'original',
      chatModel: model,
    });
    expect(out.chunks).toEqual(['original']);
  });

  it('falls back to [text] for an empty array or non-string items', async () => {
    expect(
      (
        await new ChunkMessageNode().execute({
          text: 'original',
          chatModel: new FakeChatModel('[]'),
        })
      ).chunks,
    ).toEqual(['original']);
    expect(
      (
        await new ChunkMessageNode().execute({
          text: 'original',
          chatModel: new FakeChatModel('[1, 2]'),
        })
      ).chunks,
    ).toEqual(['original']);
  });

  it('includes maxChars and the input text in the prompt', async () => {
    const model = new FakeChatModel('["x"]');
    await new ChunkMessageNode().execute({
      text: 'HELLO-TEXT',
      chatModel: model,
      maxChars: 1234,
    });
    const sent = model.calls[0].messages[0].content;
    expect(sent).toContain('1234');
    expect(sent).toContain('HELLO-TEXT');
  });

  it('defaults maxChars to 4096 when not given', async () => {
    const model = new FakeChatModel('["x"]');
    await new ChunkMessageNode().execute({ text: 't', chatModel: model });
    expect(model.calls[0].messages[0].content).toContain('4096');
  });
});
