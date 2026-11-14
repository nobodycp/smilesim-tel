import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_STORE } from './auth.store';
import { LogSender, MESSAGE_SENDER } from './message-sender';
import { PasskeyService } from './passkeys';
import { PrismaAuthStore } from './prisma-auth.store';
import { TwoFactorPolicyService } from './two-factor-policy.service';

// The AuthStore contract is implemented by Prisma (PostgreSQL) and Redis; HTTP tests override AUTH_STORE with MemoryAuthStore.
// MESSAGE_SENDER carries sign-in codes by SMS or email; LogSender until the gateways are chosen.
// ActivityRecorder is the platform's port (`shared/activity.ts`); the one implementation is provided by the global
// ActivityModule of auditing, which the app imports once (`registry.ts`). Sign-in does not import auditing.
@Module({
  controllers: [AuthController],
  providers: [AuthService, PasskeyService, TwoFactorPolicyService, { provide: AUTH_STORE, useClass: PrismaAuthStore }, { provide: MESSAGE_SENDER, useClass: LogSender }],
  exports: [AuthService, AUTH_STORE],
})
export class AuthModule {}
