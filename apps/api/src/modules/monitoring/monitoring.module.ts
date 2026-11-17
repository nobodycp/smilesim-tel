import { Module } from '@nestjs/common';
import { PlatformModule, ServerErrorRecorder } from '../platform';
import { AccessModule } from '../access';
import { RequestLogController } from './request-log.controller';
import { RequestLogRepository } from './request-log.repository';
import { RequestLogService } from './request-log.service';
import { RequestLogWriter } from './request-log.writer';

/**
 * The system monitor (spec 2026-11-17-system-monitor; ADR 0020, amended: the thirteenth module). It reads the other
 * modules and none imports it. Every route it serves is the branch owner's alone (D1: `requireOwner`).
 * `RequestLogWriter` is exported for the request-log middleware, a composition root of the app, and bound under the
 * platform's `ServerErrorRecorder` port for the error filter (M.4): one writer, one buffer, one instance.
 */
export const MONITORING_CONTROLLERS = [RequestLogController];
export const MONITORING_PROVIDERS = [RequestLogRepository, RequestLogWriter, { provide: ServerErrorRecorder, useExisting: RequestLogWriter }, RequestLogService];

@Module({
  imports: [PlatformModule, AccessModule],
  controllers: MONITORING_CONTROLLERS,
  providers: MONITORING_PROVIDERS,
  exports: [RequestLogWriter, ServerErrorRecorder],
})
export class MonitoringModule {}
