// Every "which colour is this status" decision, in one place; `<Badge variant={tone}>` draws it. A new status gets
// its tone here, not inline on a page.

export type Tone = 'success' | 'warning' | 'danger' | 'muted';

/** A line: active is good, frozen a warning, disconnected danger, anything else (suspended) neutral. */
export function lineTone(status: string): Tone {
  if (status === 'active') return 'success';
  if (status === 'frozen') return 'warning';
  if (status === 'disconnected') return 'danger';
  return 'muted';
}

/** A task: done is good, cancelled danger, pending or working still a warning. */
export function taskTone(status: string): Tone {
  if (status === 'done') return 'success';
  if (status === 'cancelled') return 'danger';
  return 'warning';
}

/** An account: frozen is a warning, open is good. */
export function accountTone(frozen: boolean): Tone {
  return frozen ? 'warning' : 'success';
}

/** A notice: unread wants attention, read is quiet. */
export function noticeTone(read: boolean): Tone {
  return read ? 'muted' : 'warning';
}

/** Something that is on or off: for sale, enabled, a grant allowed. Off is danger. */
export function onOffTone(on: boolean): Tone {
  return on ? 'success' : 'danger';
}

/** A package's terms for one account, in the order they win: stopped above or here, custom price, inherited. */
export function termsTone(row: { locked: boolean; hidden: boolean; custom: boolean }): Tone {
  if (row.locked || row.hidden) return 'danger';
  return row.custom ? 'success' : 'muted';
}

/**
 * A provider operation: waiting is information, an unconfirmed result a warning, a failure danger, a success that
 * could not be settled its own colour (it is neither), and an applied one good.
 */
export function operationTone(phase: string): Tone | 'info' | 'violet' {
  if (phase === 'applied') return 'success';
  if (phase === 'failed') return 'danger';
  if (phase === 'unknown') return 'warning';
  if (phase === 'exception') return 'violet';
  return 'info';
}

/** The amount a task held: held is a warning (it is waiting), settled good, given back quiet. */
export function holdTone(hold: string): Tone {
  if (hold === 'captured') return 'success';
  return hold === 'held' ? 'warning' : 'muted';
}

