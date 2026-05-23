jest.mock('../db/client', () => ({
  demoDb: {
    select: jest.fn(),
  },
  closeDemoDb: jest.fn(),
}));

import { demoDb } from '../db/client';
import { GetFaqsTool } from './get-faqs.tool';

const mockDb = demoDb as unknown as { select: jest.Mock };

beforeEach(() => {
  mockDb.select.mockReset();
});

describe('GetFaqsTool', () => {
  it('declares the expected name, description, and empty parameters', () => {
    const tool = new GetFaqsTool();
    expect(tool.name).toBe('get_faqs');
    expect(tool.description).toMatch(/frequently asked/i);
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it('returns every FAQ row as { question, answer }', async () => {
    const rows = [
      { id: 1, question: 'How long does SEO take?', answer: '3-6 months.' },
      { id: 2, question: 'Do you offer refunds?', answer: 'Within 7 days.' },
    ];
    const from = jest.fn().mockResolvedValue(rows);
    mockDb.select.mockReturnValue({ from });

    const out = await new GetFaqsTool().execute({});

    expect(mockDb.select).toHaveBeenCalled();
    expect(out).toEqual([
      { question: 'How long does SEO take?', answer: '3-6 months.' },
      { question: 'Do you offer refunds?', answer: 'Within 7 days.' },
    ]);
  });
});
