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
        name: 'Kpay',
        accountName: 'Aung Myat Min',
        accountNumber: '09123456789',
        note: 'Primary payment method',
      },
      {
        id: 2,
        name: 'Wave Pay',
        accountName: 'Thazin Hlaing',
        accountNumber: '09987654321',
        note: 'Mobile wallet — instant transfers',
      },
    ];
    const from = jest.fn().mockResolvedValue(rows);
    mockDb.select.mockReturnValue({ from });

    const out = await new GetPaymentMethodsTool().execute({});

    expect(mockDb.select).toHaveBeenCalled();
    expect(out).toEqual([
      {
        name: 'Kpay',
        accountName: 'Aung Myat Min',
        accountNumber: '09123456789',
        note: 'Primary payment method',
      },
      {
        name: 'Wave Pay',
        accountName: 'Thazin Hlaing',
        accountNumber: '09987654321',
        note: 'Mobile wallet — instant transfers',
      },
    ]);
  });
});
