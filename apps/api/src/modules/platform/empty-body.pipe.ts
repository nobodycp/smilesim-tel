import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';

/**
 * A write sent with no body reaches its handler as `{}`, not `undefined`: the handler's schema then answers
 * 400 for what is missing, instead of the handler crashing on `body.field`.
 */
@Injectable()
export class EmptyBodyPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    return metadata.type === 'body' && metadata.data === undefined && value === undefined ? {} : value;
  }
}
