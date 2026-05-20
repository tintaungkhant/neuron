import { serializeError } from './trace';

describe('serializeError', () => {
  it('captures message and stack from an Error', () => {
    const e = new Error('boom');
    const out = serializeError(e);
    expect(out.message).toBe('boom');
    expect(typeof out.stack).toBe('string');
  });

  it('stringifies non-Error values', () => {
    expect(serializeError('nope')).toEqual({ message: 'nope' });
    expect(serializeError(42)).toEqual({ message: '42' });
    expect(serializeError({ foo: 1 })).toEqual({ message: '[object Object]' });
  });

  it('handles null and undefined', () => {
    expect(serializeError(null)).toEqual({ message: 'null' });
    expect(serializeError(undefined)).toEqual({ message: 'undefined' });
  });
});
