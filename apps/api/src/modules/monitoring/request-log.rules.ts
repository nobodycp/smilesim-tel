// The request log's filters and figures, as plain values (backend-engineering.mdc 5.1: no Nest, no Prisma).

/** What the rows are filtered by, once the query is read. Each field narrows; none set reads every row. */
export type RequestFilter = {
  status?: { gte: number; lte: number };
  code?: string;
  route?: string;
  /** An account by login name; its id when it exists, to find it also as the account that entered another. */
  account?: { loginName: string; id: string | null };
  ip?: string;
  slowerThan?: number;
  from?: Date;
  to?: Date;
};

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
