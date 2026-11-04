import { ApiProperty } from '@nestjs/swagger';
import { ERROR_MESSAGES, type ErrorCode } from '../errors';

const ERROR_CODE_VALUES = Object.keys(ERROR_MESSAGES) as ErrorCode[];

/** Shared refusal body `{ message, code }` (see `errors.ts`). */
export class ApiErrorDto {
  @ApiProperty({ example: 'يلزم تسجيل الدخول' })
  message!: string;

  @ApiProperty({ enum: ERROR_CODE_VALUES, example: 'LOGIN_REQUIRED' })
  code!: ErrorCode;
}
