import { KernelModule } from '../kernel/kernel.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { Module } from '@nestjs/common';

/** The companies shelf and each company's SIM rules and picture. */
export const COMPANIES_CONTROLLERS = [CompaniesController];
export const COMPANIES_PROVIDERS = [CompaniesService];

@Module({
  imports: [KernelModule],
  controllers: COMPANIES_CONTROLLERS,
  providers: COMPANIES_PROVIDERS,
  exports: [],
})
export class CompaniesModule {}
