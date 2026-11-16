/** Stamp a system line onto the task log with an ISO time the ticket can render. */
export function stampTaskLog(current: string, line: string, at: Date = new Date()): string {
  const stamped = `${at.toISOString()} ${line}`;
  return current ? `${current}\n${stamped}` : stamped;
}

/**
 * Read a log line: its time and its text. Every line is stamped by `stampTaskLog`; the lines written before that
 * were given their task's creation time by migration `20261116110000_task_log_lines_stamped`. A line with no time
 * is not a line of the log: null.
 */
export function parseTaskLogLine(line: string): { body: string; at: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\s+(.+)$/u.exec(line.trim());
  return match ? { at: match[1], body: match[2] } : null;
}
