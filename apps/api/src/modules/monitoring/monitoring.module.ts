import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform';
import { RequestLogRepository } from './request-log.repository';
import { RequestLogWriter } from './request-log.writer';

/**
 * The system monitor (spec 2026-11-17-system-monitor; ADR 0020, amended: the thirteenth module). It reads the other
 * modules and none imports it. Every route it serves is the branch owner's alone (D1: `requireOwner`).
 * `RequestLogWriter` is exported for the request-log middleware, a composition root of the app.
 */
const MONITORING_PROVIDERS = [RequestLogRepository, RequestLogWriter];

@Module({
  imports: [PlatformModule],
  providers: MONITORING_PROVIDERS,
  exports: [RequestLogWriter],
})
export class MonitoringModule {}
