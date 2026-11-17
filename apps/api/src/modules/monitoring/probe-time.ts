import { performance } from 'node:perf_hooks';

// A probe's time: its limit and how long it took. Shared by the system status (M.5) and the alert pass's look at
// the same parts (M.6), so a part that hangs is `down` (`timeout`) the same way in both.

/** A probe that took too long: its part is `down` with the note `timeout` (`errorCode` names it by this class's name). */
class ProbeTimeout extends Error {
  override name = 'TimeoutError';
}

/** `run`'s answer, or `ProbeTimeout` after `ms`. The probe left behind is not waited for: its answer is dropped. */
export async function within<T>(ms: number, run: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([run(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ProbeTimeout('probe')), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

/** How long `run` took, in whole milliseconds. */
export async function timed(run: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await run();
  return Math.round(performance.now() - started);
}
