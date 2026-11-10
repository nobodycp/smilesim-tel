import { providerDispatchOn } from './config';
import { backgroundProcessors } from './worker';

describe('backgroundProcessors', () => {
  it('has no processors in the login release', () => {
    expect(backgroundProcessors).toEqual([]);
  });
});

describe('provider dispatch switch', () => {
  const before = { env: process.env.NODE_ENV, dispatch: process.env.PROVIDER_DISPATCH };
  afterEach(() => {
    process.env.NODE_ENV = before.env;
    if (before.dispatch === undefined) delete process.env.PROVIDER_DISPATCH;
    else process.env.PROVIDER_DISPATCH = before.dispatch;
  });

  it('is off unless asked for, and never on in production', () => {
    delete process.env.PROVIDER_DISPATCH;
    expect(providerDispatchOn()).toBe(false);
    process.env.PROVIDER_DISPATCH = '1';
    expect(providerDispatchOn()).toBe(true);
    process.env.PROVIDER_DISPATCH = 'true';
    expect(providerDispatchOn()).toBe(false);
    process.env.NODE_ENV = 'production';
    process.env.PROVIDER_DISPATCH = '1';
    expect(providerDispatchOn()).toBe(false);
  });
});
