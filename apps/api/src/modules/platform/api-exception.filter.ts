import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_MESSAGES, type ErrorCode } from '../../errors';
import { ApiFailure } from './api-failure';
import { isMissingRow, isUniqueViolation } from './prisma-errors';

/** The code a plain HTTP status answers with when nothing more specific is known. */
const CODE_OF_STATUS: Record<number, ErrorCode> = {
  400: 'INVALID',
  401: 'LOGIN_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'DUPLICATE_REQUEST',
  413: 'TOO_LARGE',
  429: 'RATE_LIMITED',
};

/**
 * Every error the API answers has the body `{ message, code }` (backend-engineering.mdc 4.3), whatever threw it:
 * a refusal of ours (`ApiFailure`), a framework error (unknown route, malformed JSON, body too large), a
 * database conflict, or a bug. A bug answers 500 `SERVER_ERROR` and is logged with its stack; nothing internal
 * reaches the client.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiError');

  catch(error: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw error;
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;
    const { status, code } = this.answerOf(error);
    if (status >= 500) this.logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
    response.status(status).json({ message: ERROR_MESSAGES[code], code });
  }

  private answerOf(error: unknown): { status: number; code: ErrorCode } {
    if (error instanceof ApiFailure) return { status: error.status, code: error.code };
    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status >= 500) return { status, code: 'SERVER_ERROR' };
      return { status, code: CODE_OF_STATUS[status] ?? 'INVALID' };
    }
    // A write lost a race on a unique column, or its row was gone: a conflict or a miss, not a crash.
    if (isUniqueViolation(error)) return { status: 409, code: 'DUPLICATE_REQUEST' };
    if (isMissingRow(error)) return { status: 404, code: 'NOT_FOUND' };
    // body-parser errors carry their own status (400 malformed JSON, 413 too large).
    const status = (error as { status?: unknown; statusCode?: unknown } | null)?.status ?? (error as { statusCode?: unknown } | null)?.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) return { status, code: CODE_OF_STATUS[status] ?? 'INVALID' };
    return { status: 500, code: 'SERVER_ERROR' };
  }
}
