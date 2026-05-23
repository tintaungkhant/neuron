jest.mock('../db/client', () => ({
  demoDb: {
    select: jest.fn(),
  },
  closeDemoDb: jest.fn(),
}));

import { demoDb } from '../db/client';
import { GetPaymentMethodsTool } from './get-payment-methods.tool';

const mockDb = demoDb as unknown as { select: jest.Mock };

beforeEach(() => {
  mockDb.select.mockReset();
});

describe('GetPaymentMethodsTool', () => {
  it('declares the expected name, description, and empty parameters', () => {
    const tool = new GetPaymentMethodsTool();
    expect(tool.name).toBe('get_payment_methods');
    expect(tool.description).toMatch(/payment method/i);
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it('returns every payment method row mapped to plain objects', async () => {
    const rows = [
      {
        id: 1,
        name: 'KBZ Pay',
        accountName: 'Better Solutions',
        accountNumber: '09xxx',
        note: 'mobile',
      },
      {
        id: 2,
        name: 'Bank Transfer',
        accountName: 'Better Solutions Co.',
        accountNumber: '0123-4567',
        note: null,
      },
    ];
    const from = jest.fn().mockResolvedValue(rows);
    mockDb.select.mockReturnValue({ from });

    const out = await new GetPaymentMethodsTool().execute({});

    expect(mockDb.select).toHaveBeenCalled();
    expect(out).toEqual([
      {
        name: 'KBZ Pay',
        accountName: 'Better Solutions',
        accountNumber: '09xxx',
        note: 'mobile',
      },
      {
        name: 'Bank Transfer',
        accountName: 'Better Solutions Co.',
        accountNumber: '0123-4567',
        note: null,
      },
    ]);
  });
});
