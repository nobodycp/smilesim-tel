// Which writes this tab has sent, so a read can tell whether one happened since it was asked (speed plan PF.4,
// decision 12 of spec 2026-11-17-scale-speed-cleanup). `lib/http.ts` counts every request that is not a GET, at its
// start and at its end; `useApiQuery` takes a mark when a read starts and shares that answer for a few seconds only
// while the mark still holds. A write on the way, or one sent since, means the next read goes to the server.

let generation = 0;
let inFlight = 0;

/** A write is on its way. */
export function writeStarted() {
  generation += 1;
  inFlight += 1;
}

/** A write has answered (or failed). */
export function writeEnded() {
  generation += 1;
  inFlight = Math.max(0, inFlight - 1);
}

/** The mark a read takes when it starts. */
export function readMark(): number {
  return generation;
}

/** No write was on its way or sent since `mark` was taken (and none is now). */
export function noWriteSince(mark: number | undefined): boolean {
  return mark !== undefined && inFlight === 0 && mark === generation;
}
