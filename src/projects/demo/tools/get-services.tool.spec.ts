jest.mock('../db/client', () => ({
  demoDb: {
    select: jest.fn(),
  },
  closeDemoDb: jest.fn(),
}));

import { demoDb } from '../db/client';
import { GetServicesTool } from './get-services.tool';

const mockDb = demoDb as unknown as { select: jest.Mock };

beforeEach(() => {
  mockDb.select.mockReset();
});

describe('GetServicesTool', () => {
  it('declares the expected name, description, and empty parameters', () => {
    const tool = new GetServicesTool();
    expect(tool.name).toBe('get_services');
    expect(tool.description).toMatch(/Fetch the full list of services/);
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it('returns every service row as plain objects', async () => {
    const rows = [
      {
        id: 1,
        name: 'SEO',
        description: 'Search engine optimization',
        pricing: '$500/month',
        requirementsFromCustomer: 'site URL',
      },
      {
        id: 2,
        name: 'Ads',
        description: 'Paid ads management',
        pricing: '$1000/month',
        requirementsFromCustomer: 'ad accounts',
      },
    ];
    const from = jest.fn().mockResolvedValue(rows);
    mockDb.select.mockReturnValue({ from });

    const out = await new GetServicesTool().execute({});

    expect(mockDb.select).toHaveBeenCalled();
    expect(out).toEqual([
      {
        name: 'SEO',
        description: 'Search engine optimization',
        pricing: '$500/month',
        requirementsFromCustomer: 'site URL',
      },
      {
        name: 'Ads',
        description: 'Paid ads management',
        pricing: '$1000/month',
        requirementsFromCustomer: 'ad accounts',
      },
    ]);
  });
});
