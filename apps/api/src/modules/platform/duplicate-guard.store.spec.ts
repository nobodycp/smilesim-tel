import type IORedis from 'ioredis';
import { redisWrites } from './duplicate-guard.interceptor';

// The guard's Redis store, on a scripted Redis: what `claim` answers when the key changes between its two
// commands. A claim is two round trips (`SET … NX`, then `GET` when the key was taken), and the holder of the key
// may fail and drop it between them. `claim` answers `null` only for a key this request now holds: answering it
// for a key that merely went away lets every waiting repeat run at once, each without the mark.

/** A Redis of one key, whose holder drops it once, right after the `dropAfter`-th refused `SET NX` and before any `GET`. */
function scripted(dropAfter: number) {
  const rows = new Map<string, string>();
  let refused = 0;
  const redis = {
    set: async (key: string, value: string, ...flags: unknown[]) => {
      if (flags.includes('NX') && rows.has(key)) {
        refused += 1;
        if (refused === dropAfter) rows.delete(key);
        return null;
      }
      rows.set(key, value);
      return 'OK';
    },
    get: async (key: string) => rows.get(key) ?? null,
    del: async (key: string) => (rows.delete(key) ? 1 : 0),
  };
  return { store: redisWrites(redis as unknown as IORedis), rows };
}

describe('the duplicate guard\'s Redis store', () => {
  it('claims a free key, and answers what a taken key holds', async () => {
    const { store, rows } = scripted(0);
    expect(await store.claim('k', 60)).toBeNull();
    expect(rows.get('k')).toBe('__pending__');
    expect(await store.claim('k', 60)).toBe('__pending__');
    await store.save('k', '{"taskId":"t1"}', 60);
    expect(await store.claim('k', 60)).toBe('{"taskId":"t1"}');
    await store.drop('k');
    expect(await store.claim('k', 60)).toBeNull();
  });

  it('a key dropped between the two commands is asked for again, and is then really held', async () => {
    const { store, rows } = scripted(1);
    rows.set('k', '__pending__');
    // The first holder failed and dropped the key right after this request's `SET NX` was refused.
    expect(await store.claim('k', 60, 'mine')).toBeNull();
    // Null means "yours": the key holds this request's own mark, so the next repeat finds it taken.
    expect(rows.get('k')).toBe('mine');
    expect(await store.claim('k', 60, 'other')).toBe('mine');
  });

  it('four repeats that meet the same dropped key: one holds it, three are told it is taken', async () => {
    // All four were refused while the first holder still ran; it failed and dropped the key before any of them read it.
    const { store, rows } = scripted(4);
    rows.set('k', '__pending__');
    const answers = await Promise.all(['a', 'b', 'c', 'd'].map((marker) => store.claim('k', 60, marker)));
    expect(answers.filter((answer) => answer === null)).toHaveLength(1);
    expect(answers.filter((answer) => answer !== null).every((answer) => answer === rows.get('k'))).toBe(true);
  });

  it('a key that is taken and unreadable every time is never answered as held: the request is told it is still running', async () => {
    let asked = 0;
    const redis = { set: async () => { asked += 1; return null; }, get: async () => null, del: async () => 0 };
    const store = redisWrites(redis as unknown as IORedis);
    expect(await store.claim('k', 60)).toBe('__pending__');
    // Bounded: it asks a few times and gives up, it does not spin.
    expect(asked).toBeGreaterThan(1);
    expect(asked).toBeLessThanOrEqual(5);
  });
});
