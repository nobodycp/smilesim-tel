/** Stamp a system line onto the task log with an ISO time the ticket can render. */
export function stampTaskLog(current: string, line: string, at: Date = new Date()): string {
  const stamped = `${at.toISOString()} ${line}`;
  return current ? `${current}\n${stamped}` : stamped;
}

/** Read a stamped log line, or fall back for legacy rows that have no time. */
export function parseTaskLogLine(line: string, fallbackAt: string): { body: string; at: string } {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\s+(.+)$/u.exec(line.trim());
  if (!match) return { body: line.trim(), at: fallbackAt };
  return { at: match[1], body: match[2] };
}
