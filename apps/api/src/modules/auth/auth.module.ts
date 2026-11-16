import { Module } from '@nestjs/common';
import { AccountSecurityController } from './account-security.controller';
import { AuthRecords } from './auth-records';
import { AuthService } from './auth.service';
import { AUTH_STORE } from './auth.store';
import { LogSender, MESSAGE_SENDER } from './message-sender';
import { OwnAccountController } from './own-account.controller';
import { PasskeyService } from './passkeys';
import { PrismaAuthStore } from './prisma-auth.store';
import { SignInController } from './sign-in.controller';
import { TwoFactorPolicyService } from './two-factor-policy.service';

// The AuthStore contract is implemented by Prisma (PostgreSQL) and Redis; HTTP tests override AUTH_STORE with MemoryAuthStore.
// MESSAGE_SENDER carries sign-in codes by SMS or email; LogSender until the gateways are chosen.
// ActivityRecorder is the platform's port (`platform/activity.ts`); the one implementation is provided by the global
// ActivityModule of auditing, which the app imports once (`registry.ts`). Sign-in does not import auditing.
@Module({
  controllers: [SignInController, OwnAccountController, AccountSecurityController],
  providers: [AuthService, AuthRecords, PasskeyService, TwoFactorPolicyService, { provide: AUTH_STORE, useClass: PrismaAuthStore }, { provide: MESSAGE_SENDER, useClass: LogSender }],
  exports: [AuthService, AUTH_STORE],
})
export class AuthModule {}
