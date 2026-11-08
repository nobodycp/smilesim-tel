// Every "which colour is this status" decision, in one place. `<Badge variant={tone}>` takes a tone directly; the
// plain `.badge` span takes `badgeClass(tone)`. A new status gets its tone here, not inline on a page.

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

/** The plain `.badge` class for a tone (desk.css: no modifier is success). */
export function badgeClass(tone: Tone): string {
  return tone === 'success' ? 'badge' : tone === 'warning' ? 'badge pending' : tone === 'danger' ? 'badge cancelled' : 'badge muted';
}
