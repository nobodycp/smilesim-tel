import { CompaniesRepository } from './companies.repository';
import { AccessModule } from '../../../access';
import { PlatformModule } from '../../../platform';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { Module } from '@nestjs/common';

/** The companies shelf and each company's SIM rules and picture. */
export const COMPANIES_CONTROLLERS = [CompaniesController];
export const COMPANIES_PROVIDERS = [CompaniesRepository, CompaniesService];

@Module({
  imports: [PlatformModule, AccessModule],
  controllers: COMPANIES_CONTROLLERS,
  providers: COMPANIES_PROVIDERS,
  exports: [],
})
export class CompaniesModule {}
