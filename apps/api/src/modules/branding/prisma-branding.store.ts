import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { createPrismaClient, PrismaService } from '../platform';
import { PrismaClient } from '../../generated/prisma/client';
import type { BrandingBody, BrandingFacts, BrandingImageRow, BrandingRow, ImageKind } from './branding-rules';
import { imageSource, type BrandingStore } from './branding.store';

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

  // Raw SQL because Prisma cannot select "is this column set" without reading it: the images are up to
  // ~400 KB of base64 each and the answer is 129 bytes.
  async loadFacts(): Promise<BrandingFacts | null> {
    const rows = await this.prisma.$queryRaw<BrandingFacts[]>`
      SELECT "siteName", "tagline",
             COALESCE("logo", '') <> '' AS "hasLogo",
             COALESCE("favicon", '') <> '' AS "hasFavicon",
             "updatedAt"
        FROM "SiteBranding" WHERE "id" = ${ROW_ID}`;
    return rows[0] ?? null;
  }

  async loadImage(kind: ImageKind): Promise<BrandingImageRow | null> {
    const row = await this.prisma.siteBranding.findUnique({
      where: { id: ROW_ID },
      select: {
        updatedAt: true,
        logo: kind !== 'favicon',
        logoDark: kind === 'logo-dark',
        favicon: kind === 'favicon',
      },
    });
    if (!row) return null;
    return { source: imageSource(kind, { logo: row.logo ?? null, logoDark: row.logoDark ?? null, favicon: row.favicon ?? null }), updatedAt: row.updatedAt };
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
