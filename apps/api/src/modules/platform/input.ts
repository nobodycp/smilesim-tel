import type { z } from 'zod';
import { fail } from './api-failure';

/**
 * Checks a request body or query against its schema and answers 400 INVALID when it does not fit, the same refusal
 * the hand-written checks gave. Called inside the service after the actor is known, so a request without a session
 * still answers 401 before its body is judged (ADR 0002).
 */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) fail(400, 'INVALID');
  return result.data;
}
