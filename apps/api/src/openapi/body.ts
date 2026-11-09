import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Documents a route's body from the schema that validates it, so the docs cannot drift from what the handler
 * accepts (backend-engineering.mdc 4.1).
 */
export function ApiZodBody(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete json.$schema;
  return ApiBody({ schema: json });
}
