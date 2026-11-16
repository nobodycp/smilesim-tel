import { Module } from '@nestjs/common';

/**
 * The system monitor (spec 2026-11-17-system-monitor; ADR 0020, amended: the thirteenth module). It reads the other
 * modules and none imports it. Every route it serves is the branch owner's alone (D1: `requireOwner`).
 */
@Module({})
export class MonitoringModule {}
