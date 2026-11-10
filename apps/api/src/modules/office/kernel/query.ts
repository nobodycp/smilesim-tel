/** A query value is a string or nothing; a repeated or nested one is ignored. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
