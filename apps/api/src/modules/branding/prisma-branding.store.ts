import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient } from '../../db';
import { PrismaClient } from '../../generated/prisma/client';
import type { BrandingBody, BrandingRow } from './branding-rules';
import type { BrandingStore } from './branding.store';

const ROW_ID = 1;

@Injectable()
export class PrismaBrandingStore implements BrandingStore, OnModuleDestroy {
  private prismaClient: PrismaClient | null = null;

  private get prisma(): PrismaClient {
    this.prismaClient ??= createPrismaClient();
    return this.prismaClient;
  }

  async load(): Promise<BrandingRow | null> {
    return this.prisma.siteBranding.findUnique({ where: { id: ROW_ID } });
  }

  async save(body: BrandingBody): Promise<BrandingRow> {
    return this.prisma.siteBranding.upsert({
      where: { id: ROW_ID },
      create: { id: ROW_ID, ...body },
      update: body,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.prismaClient?.$disconnect();
  }
}
