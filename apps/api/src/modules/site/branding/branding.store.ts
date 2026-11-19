// Where the one SiteBranding row lives. Prisma in the app; memory in the HTTP tests.
import {
  factsOf,
  type BrandingBody,
  type BrandingFacts,
  type BrandingImageRow,
  type BrandingRow,
  type ImageKind,
} from './branding-rules';

export const BRANDING_STORE = Symbol('BRANDING_STORE');

export interface BrandingStore {
  /** The row's text and version and whether each image is there, without reading the images; null before any save. */
  loadFacts(): Promise<BrandingFacts | null>;
  /** One image's data URL (the dark logo falls back to the light one) and the row's version; null before any save. */
  loadImage(kind: ImageKind): Promise<BrandingImageRow | null>;
  /** Replaces the row and returns it with its new updatedAt. */
  save(body: BrandingBody): Promise<BrandingRow>;
}

/** The column one image route reads; the dark logo reads the light one beside it for its fallback. */
export function imageSource(kind: ImageKind, row: Pick<BrandingRow, 'logo' | 'logoDark' | 'favicon'>): string | null {
  if (kind === 'favicon') return row.favicon;
  if (kind === 'logo-dark') return row.logoDark ?? row.logo;
  return row.logo;
}

export class MemoryBrandingStore implements BrandingStore {
  private row: BrandingRow | null = null;

  async loadFacts(): Promise<BrandingFacts | null> {
    return this.row ? factsOf(this.row) : null;
  }

  async loadImage(kind: ImageKind): Promise<BrandingImageRow | null> {
    return this.row ? { source: imageSource(kind, this.row), updatedAt: this.row.updatedAt } : null;
  }

  async save(body: BrandingBody): Promise<BrandingRow> {
    this.row = { ...body, updatedAt: new Date() };
    return this.row;
  }
}
