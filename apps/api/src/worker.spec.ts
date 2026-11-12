import { backgroundProcessors } from './worker';

describe('backgroundProcessors', () => {
  it('has no processors of its own: the two of provider operations are added when the worker runs', () => {
    expect(backgroundProcessors).toEqual([]);
  });
});
