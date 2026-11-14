/** Whether the error is PostgreSQL refusing a duplicate on a unique column (Prisma `P2002`). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/** Whether the error is Prisma finding no row for a write that needed one (`P2025`). */
export function isMissingRow(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2025';
}
