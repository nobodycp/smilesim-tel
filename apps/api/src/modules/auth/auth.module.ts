import { Module } from '@nestjs/common';
import { ActivityModule } from '../office/activity/activity.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_STORE } from './auth.store';
import { LogSender, MESSAGE_SENDER } from './message-sender';
import { PasskeyService } from './passkeys';
import { PrismaAuthStore } from './prisma-auth.store';
import { TwoFactorPolicyService } from './two-factor-policy.service';

// The AuthStore contract is implemented by Prisma (PostgreSQL) and Redis; HTTP tests override AUTH_STORE with MemoryAuthStore.
// MESSAGE_SENDER carries sign-in codes by SMS or email; LogSender until the gateways are chosen.
// ActivityRecorder comes from ActivityModule (one instance for the process), re-exported for modules that import AuthModule.
@Module({
  imports: [ActivityModule],
  controllers: [AuthController],
  providers: [AuthService, PasskeyService, TwoFactorPolicyService, { provide: AUTH_STORE, useClass: PrismaAuthStore }, { provide: MESSAGE_SENDER, useClass: LogSender }],
  exports: [AuthService, AUTH_STORE, ActivityModule],
})
export class AuthModule {}
