/** A query value is a string or nothing; a repeated or nested one is ignored. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** OpenAPI body schema for routes whose fields the service still checks by hand. */
export const freeFormObject = {
  type: 'object' as const,
  additionalProperties: true,
  description: 'Free-form JSON object; fields validated in the service',
};
