// The request log's filters and figures, as plain values (backend-engineering.mdc 5.1: no Nest, no Prisma).

/** What the rows are filtered by, once the query is read. Each field narrows; none set reads every row. */
export type RequestFilter = {
  status?: { gte: number; lte: number };
  code?: string;
  method?: string;
  /** The route pattern, exact; `''` is the requests no route matched. */
  route?: string;
  /** A part of the path as sent, case ignored, matched literally (`%`, `_` and a backslash are no wildcards). */
  pathContains?: string;
  /** An account by login name; its id when it exists, to find it also as the account that entered another. */
  account?: { loginName: string; id: string | null };
  /** The start of the caller's address. */
  ipStartsWith?: string;
  slowerThan?: number;
  from?: Date;
  to?: Date;
};

/** What the server errors are filtered by: a route pattern and a time range. */
export type ErrorFilter = { route?: string; from?: Date; to?: Date };
/** `text` for a `LIKE` pattern: its `%`, `_` and backslash match themselves (the backslash is PostgreSQL's default escape). */
export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** `4xx` is 400–499; `404` is 404 alone. */
export function statusRange(status: string): { gte: number; lte: number } {
  if (status.endsWith('xx')) {
    const hundred = Number(status[0]) * 100;
    return { gte: hundred, lte: hundred + 99 };
  }
  return { gte: Number(status), lte: Number(status) };
}

/** The share of answers that were server errors (5xx), 0 to 1 with four decimals; 0 when there were none. */
export function errorRate(failed: number, count: number): number {
  return count > 0 ? Math.round((failed / count) * 10_000) / 10_000 : 0;
}
