import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger, Optional } from '@nestjs/common';
import type { Request, Response } from 'express';
import { isProduction, isTest } from '../../config';
import { ERROR_MESSAGES, type ErrorCode } from '../../errors';
import { ApiFailure } from './api-failure';
import { errorReport, type ErrorReport } from './log';
import { isMissingRow, isStatementCancelled, isUniqueViolation } from './prisma-errors';
import { ServerErrorRecorder } from './server-errors';

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

/** Where a server error happened: the request id the request log set on the answer, the method and the route pattern. */
type RequestPlace = { requestId: string; method: string; route: string };

/** Nothing else of the request: never its path as sent, its query, its headers or its body. */
function requestOf(req: Request, response: Response): RequestPlace {
  const requestId = response.getHeader('x-request-id');
  const route = (req.route as { path?: unknown } | undefined)?.path;
  return { requestId: typeof requestId === 'string' ? requestId : '', method: req.method, route: typeof route === 'string' ? route.slice(0, 200) : '' };
}

/**
 * Every error the API answers has the body `{ message, code }` (backend-engineering.mdc 4.3), whatever threw it:
 * a refusal of ours (`ApiFailure`), a framework error (unknown route, malformed JSON, body too large), a
 * database conflict, or a bug. A bug answers 500 `SERVER_ERROR`; nothing internal reaches the client. A 5xx is
 * logged and handed to the server error port (system monitor M.4) as `errorReport` keeps it: the class, a code
 * for the message and the code-location frames, never the error's own words, which may quote a body, a query or a
 * header (system monitor M.10). The log line carries the request id, the method and the route pattern, so the row
 * of the errors page is found from the log and the other way round. An app without the port (most specs) records
 * nothing.
 *
 * A developer's own run (`NODE_ENV` neither `production` nor `test`) also logs the raw stack, message included,
 * because a local log is the developer's and the frames alone often do not say what went wrong. The image sets
 * `NODE_ENV=production`, so no deployment logs it; specs do not either.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiError');

  constructor(@Optional() private readonly errors?: ServerErrorRecorder) {}

  catch(error: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw error;
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;
    const { status, code } = this.answerOf(error);
    if (status >= 500) this.keep(error, status, host.switchToHttp().getRequest<Request>(), response);
    response.status(status).json({ message: ERROR_MESSAGES[code], code });
  }

  /** Logs a 5xx and hands it to the port; neither ever changes the answer. */
  private keep(error: unknown, status: number, req: Request, response: Response): void {
    try {
      const report = errorReport(error);
      const where = requestOf(req, response);
      this.log(status, where, report, error);
      this.errors?.record({ ...where, at: new Date(), ...report });
    } catch {
      // Keeping the error never changes the answer.
    }
  }

  /**
   * One entry: `500 GET /v1/postpaid/lines/:id request <id>: TypeError unclassified`, then the frames one a line. Nothing of
   * the request but its id, method and pattern; nothing of the error but what `errorReport` keeps.
   */
  private log(status: number, where: RequestPlace, report: ErrorReport, error: unknown): void {
    const head = `${status} ${where.method} ${where.route || '(no route)'} request ${where.requestId || '-'}: ${report.name} ${report.message}`;
    this.logger.error([head, ...report.frames.map((frame) => `    at ${frame}`)].join('\n'));
    if (!isProduction() && !isTest()) this.logger.error(`request ${where.requestId || '-'}, raw (never logged in production): ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
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
    // A statement that ran past its time limit (DB.15: 15 s, an export 90 s) was cancelled by PostgreSQL. A server
    // error, kept and logged by its code (`57014`); the caller is told the request took too long, not that it broke.
    // 500 and not 503: the web takes a 502, 503 or 504 for a gateway's answer and would say the server is unreachable.
    if (isStatementCancelled(error)) return { status: 500, code: 'TOO_SLOW' };
    // body-parser errors carry their own status (400 malformed JSON, 413 too large).
    const status = (error as { status?: unknown; statusCode?: unknown } | null)?.status ?? (error as { statusCode?: unknown } | null)?.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) return { status, code: CODE_OF_STATUS[status] ?? 'INVALID' };
    return { status: 500, code: 'SERVER_ERROR' };
  }
}
