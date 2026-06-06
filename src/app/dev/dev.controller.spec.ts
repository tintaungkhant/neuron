import { NotFoundException } from '@nestjs/common';
import { DevController } from './dev.controller';
import type { ExecutionStore } from '../../engine';

function makeStore(over: Partial<ExecutionStore> = {}): ExecutionStore {
  return {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    save: jest.fn(),
    ...over,
  } as unknown as ExecutionStore;
}

describe('DevController', () => {
  it('serves the HTML page with the dev title', () => {
    const html = new DevController(makeStore()).page();
    expect(html).toContain('Neuron Dev');
  });

  it('lists executions with the default limit of 50', async () => {
    const list = jest.fn().mockResolvedValue([{ id: 1 }]);
    const c = new DevController(makeStore({ list } as Partial<ExecutionStore>));
    const out = await c.list(undefined);
    expect(list).toHaveBeenCalledWith(50);
    expect(out).toEqual([{ id: 1 }]);
  });

  it('passes a numeric limit through to the store', async () => {
    const list = jest.fn().mockResolvedValue([]);
    const c = new DevController(makeStore({ list } as Partial<ExecutionStore>));
    await c.list('10');
    expect(list).toHaveBeenCalledWith(10);
  });

  it('returns a single execution record by id', async () => {
    const record = { id: 7, workflowName: 'w' };
    const get = jest.fn().mockResolvedValue(record);
    const c = new DevController(makeStore({ get } as Partial<ExecutionStore>));
    const out = await c.get('7');
    expect(get).toHaveBeenCalledWith(7);
    expect(out).toBe(record);
  });

  it('throws NotFound when the execution is missing', async () => {
    const get = jest.fn().mockResolvedValue(null);
    const c = new DevController(makeStore({ get } as Partial<ExecutionStore>));
    await expect(c.get('999')).rejects.toBeInstanceOf(NotFoundException);
  });
});
