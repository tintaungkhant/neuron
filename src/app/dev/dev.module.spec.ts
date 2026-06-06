import { DevModule, devUiImports } from './dev.module';

describe('devUiImports', () => {
  it('registers DevModule when enabled', () => {
    expect(devUiImports(true)).toEqual([DevModule]);
  });

  it('registers nothing when disabled', () => {
    expect(devUiImports(false)).toEqual([]);
  });
});
