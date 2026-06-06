import { appConfig } from './config';

describe('appConfig', () => {
  it('exposes devUiEnabled as a boolean reflecting DEV_UI_ENABLED', () => {
    expect(typeof appConfig.devUiEnabled).toBe('boolean');
    expect(appConfig.devUiEnabled).toBe(process.env.DEV_UI_ENABLED === 'true');
  });
});
