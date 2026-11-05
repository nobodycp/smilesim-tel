// Where the one SiteBranding row lives. Prisma in the app; memory in the HTTP tests.
import type { BrandingBody, BrandingRow } from './branding-rules';

export const BRANDING_STORE = Symbol('BRANDING_STORE');

export interface BrandingStore {
  /** The row, or null before anything was saved. */
  load(): Promise<BrandingRow | null>;
  /** Replaces the row and returns it with its new updatedAt. */
  save(body: BrandingBody): Promise<BrandingRow>;
}

export class MemoryBrandingStore implements BrandingStore {
  private row: BrandingRow | null = null;

  async load(): Promise<BrandingRow | null> {
    return this.row;
  }

  async save(body: BrandingBody): Promise<BrandingRow> {
    this.row = { ...body, updatedAt: new Date() };
    return this.row;
  }
}
