import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ApiErrorDto } from './error.dto';

/** Standard refusal body for documented 4xx statuses. */
export function ApiErrorResponse(...statuses: number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({ status, description: 'Refusal `{ message, code }`', type: ApiErrorDto }),
    ),
  );
}
