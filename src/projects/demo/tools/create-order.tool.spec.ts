jest.mock('../db/client', () => ({
  demoDb: {
    select: jest.fn(),
    insert: jest.fn(),
  },
  closeDemoDb: jest.fn(),
}));

import { demoDb } from '../db/client';
import { CreateOrderTool } from './create-order.tool';

const mockDb = demoDb as unknown as {
  select: jest.Mock;
  insert: jest.Mock;
};

beforeEach(() => {
  mockDb.select.mockReset();
  mockDb.insert.mockReset();
});

function stubChatLookup(rows: { id: number }[]) {
  const limit = jest.fn().mockResolvedValue(rows);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  mockDb.select.mockReturnValue({ from });
}

describe('CreateOrderTool', () => {
  it('declares the expected name, description, and summary parameter', () => {
    const tool = new CreateOrderTool({ chatExtId: 99 });
    expect(tool.name).toBe('create_order');
    expect(tool.description).toMatch(/create_order|create an order/i);
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description:
            'Full order summary: chosen service, all requirements gathered from the customer, agreed price, and payment method if discussed.',
        },
      },
      required: ['summary'],
      additionalProperties: false,
    });
  });

  it('inserts an order tied to the chat row and returns the new order id', async () => {
    stubChatLookup([{ id: 7 }]);
    const returning = jest.fn().mockResolvedValue([{ id: 1001 }]);
    const values = jest.fn().mockReturnValue({ returning });
    mockDb.insert.mockReturnValue({ values });

    const out = await new CreateOrderTool({ chatExtId: 99 }).execute({
      summary: 'SEO package, site URL provided, KBZ Pay',
    });

    expect(mockDb.select).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith({
      chatId: 7,
      summary: 'SEO package, site URL provided, KBZ Pay',
    });
    expect(out).toEqual({ id: 1001 });
  });

  it('throws when no chat row matches the chatExtId', async () => {
    stubChatLookup([]);

    await expect(
      new CreateOrderTool({ chatExtId: 99 }).execute({
        summary: 'whatever',
      }),
    ).rejects.toThrow(/chat .*99.* not found/i);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects when summary is missing or empty', async () => {
    stubChatLookup([{ id: 7 }]);

    await expect(
      new CreateOrderTool({ chatExtId: 99 }).execute({}),
    ).rejects.toThrow(/summary/i);

    await expect(
      new CreateOrderTool({ chatExtId: 99 }).execute({ summary: '' }),
    ).rejects.toThrow(/summary/i);
  });
});
