import type { Provider } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ApiExceptionFilter } from './api-exception.filter';
import { EmptyBodyPipe } from './empty-body.pipe';

/**
 * What every HTTP app of this API is built with: one error shape and a body that is never `undefined`. The real
 * app (`AppModule`) and the HTTP spec apps register the same list, so a spec sees what production answers.
 */
export const API_PROVIDERS: Provider[] = [
  { provide: APP_FILTER, useClass: ApiExceptionFilter },
  { provide: APP_PIPE, useClass: EmptyBodyPipe },
];
