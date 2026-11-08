import { Injectable, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { parseInput } from './input';

/** `@Body(new ZodPipe(Schema))`: the typed body, or 400 INVALID (ADR 0002). Runs after the interceptors. */
@Injectable()
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    return parseInput(this.schema, value);
  }
}
