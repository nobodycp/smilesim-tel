import { Module } from '@nestjs/common';
import { PlatformModule, ServerErrorRecorder } from '../platform';
import { AccessModule } from '../access';
import { ProvidersModule } from '../providers';
import { AlertRepository } from './alert.repository';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { RequestLogController } from './request-log.controller';
import { RequestLogRepository } from './request-log.repository';
import { RequestLogService } from './request-log.service';
import { RequestLogWriter } from './request-log.writer';
import { StatusController } from './status.controller';
import { StatusRedis } from './status-redis';
import { StatusRepository } from './status.repository';
import { StatusService } from './status.service';
import { VersionsController } from './versions.controller';
import { VersionsRepository } from './versions.repository';
import { VersionsService } from './versions.service';
import { WorkerWatchService } from './worker-watch';

/**
 * The system monitor (spec 2026-11-17-system-monitor; ADR 0020, amended: the thirteenth module). It reads the other
 * modules and none imports it. Every route it serves is the branch owner's alone (D1: `requireOwner`).
 * `RequestLogWriter` is exported for the request-log middleware, a composition root of the app, and bound under the
 * platform's `ServerErrorRecorder` port for the error filter (M.4): one writer, one buffer, one instance. The status
 * (M.5) reads the providers' health through `ProvidersModule`. The alerts (M.6) are written by the worker's pass
 * (`alert-pass.ts`, not a provider here: the API runs no pass) and read, marked seen and cleared here; the one alert
 * the API opens itself is the worker's being down (M.9, `WorkerWatchService`), which a stopped worker cannot raise.
 * The versions (M.11) are checked by the worker once a day (`version-check.ts`) and on the owner's request here.
 */
export const MONITORING_CONTROLLERS = [RequestLogController, StatusController, AlertsController, VersionsController];
export const MONITORING_PROVIDERS = [
  RequestLogRepository, RequestLogWriter, { provide: ServerErrorRecorder, useExisting: RequestLogWriter }, RequestLogService, StatusRepository, StatusRedis, StatusService,
  AlertRepository, AlertsService, WorkerWatchService, VersionsRepository, VersionsService,
];

@Module({
  imports: [PlatformModule, AccessModule, ProvidersModule],
  controllers: MONITORING_CONTROLLERS,
  providers: MONITORING_PROVIDERS,
  exports: [RequestLogWriter, ServerErrorRecorder],
})
export class MonitoringModule {}
