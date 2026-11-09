/** A handoff code lives a minute: long enough for the browser to open the other door, short enough to be useless later. */
export const HANDOFF_SECONDS = 60;
export const handoffKey = (code: string) => `handoff:${code}`;
