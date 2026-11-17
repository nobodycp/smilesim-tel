/** Whether the error is PostgreSQL refusing a duplicate on a unique column (Prisma `P2002`). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/** Whether the error is Prisma finding no row for a write that needed one (`P2025`). */
export function isMissingRow(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2025';
}

/** PostgreSQL's code for a statement cancelled, here by its time limit (`statement_timeout`, DB.15). */
export const STATEMENT_CANCELLED = '57014';

/**
 * Whether the error is a statement PostgreSQL cancelled (`57014`): the driver's own error, or Prisma's wrapping of
 * it (`P2010` for raw SQL, `P2039` for a model query), which carries the driver's code in `meta`.
 */
export function isStatementCancelled(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } };
  if (code === STATEMENT_CANCELLED) return true;
  return (code === 'P2010' || code === 'P2039') && meta?.driverAdapterError?.cause?.originalCode === STATEMENT_CANCELLED;
}
