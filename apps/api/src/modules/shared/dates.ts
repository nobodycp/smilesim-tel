/**
 * The bounds of a `from` / `to` filter. A bare day (`YYYY-MM-DD`) means the whole day in UTC: `from` its first
 * instant, `to` its last millisecond, so the same filter selects the same rows wherever the server runs. A full
 * timestamp is taken as written. A value that is not a date is no bound.
 */
export function dayRange(from?: string, to?: string): { from: Date | null; to: Date | null } {
  const read = (value: string | undefined, endOfDay: boolean): Date | null => {
    if (!value) return null;
    const date = new Date(value.length === 10 ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  return { from: read(from, false), to: read(to, true) };
}
