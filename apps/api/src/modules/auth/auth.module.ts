import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_STORE } from './auth.store';
import { createTrialStore } from './trial-store';

@Module({
  controllers: [AuthController],
  providers: [AuthService, { provide: AUTH_STORE, useFactory: createTrialStore }],
  exports: [AuthService],
})
export class AuthModule {}
