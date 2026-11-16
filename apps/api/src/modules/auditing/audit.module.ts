import { AuditRepository } from './audit.repository';
import { AccessModule } from '../access';
import { PlatformModule } from '../platform';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { Module } from '@nestjs/common';

/** The activity log as the audit page reads it. */
export const AUDIT_CONTROLLERS = [AuditController];
export const AUDIT_PROVIDERS = [AuditRepository, AuditService];

@Module({
  imports: [PlatformModule, AccessModule],
  controllers: AUDIT_CONTROLLERS,
  providers: AUDIT_PROVIDERS,
  exports: [],
})
export class AuditModule {}
