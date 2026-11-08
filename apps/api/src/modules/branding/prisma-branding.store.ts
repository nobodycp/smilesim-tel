import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { createPrismaClient } from '../../db';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../shared/prisma.service';
import type { BrandingBody, BrandingRow } from './branding-rules';
import type { BrandingStore } from './branding.store';

const ROW_ID = 1;

@Injectable()
export class PrismaBrandingStore implements BrandingStore, OnModuleDestroy {
  private prismaClient: PrismaClient | null = null;

  constructor(@Optional() private readonly db?: PrismaService) {}

  // The shared client belongs to PrismaService; only a client opened here is closed here.
  private ownsClient = false;

  private get prisma(): PrismaClient {
    if (!this.prismaClient) {
      this.ownsClient = !this.db;
      this.prismaClient = this.db?.client ?? createPrismaClient();
    }
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
    if (this.ownsClient) await this.prismaClient?.$disconnect();
  }
}
