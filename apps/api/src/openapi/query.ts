import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Documents a route's query parameters from the schema that validates them, so the docs cannot drift from what
 * the handler accepts (backend-engineering.mdc 4.1). Every parameter is optional text; an enum lists its values.
 */
export function ApiZodQuery(schema: z.ZodObject) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as { properties?: Record<string, { enum?: string[] }> };
  return applyDecorators(
    ...Object.entries(json.properties ?? {}).map(([name, property]) => ApiQuery({ name, required: false, ...(property.enum ? { enum: property.enum } : {}) })),
  );
}
