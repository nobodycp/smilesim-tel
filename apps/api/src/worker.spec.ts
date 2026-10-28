import { backgroundProcessors } from './worker';

describe('backgroundProcessors', () => {
  it('has no processors in the login release', () => {
    expect(backgroundProcessors).toEqual([]);
  });
});
