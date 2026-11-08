import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { OfficeFailure } from './office-failure';

/** A refusal from an office route answers with its status and `{ message, code }`, as the web app expects. */
@Catch(OfficeFailure)
export class OfficeFailureFilter implements ExceptionFilter {
  catch(error: OfficeFailure, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(error.status).json({ message: error.message, code: error.code });
  }
}
