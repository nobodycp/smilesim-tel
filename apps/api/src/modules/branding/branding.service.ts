import { Inject, Injectable } from '@nestjs/common';
import { AUTH_STORE, AuthStore } from '../auth';
import { ApiFailure } from '../platform';
import {
  brandingSummary,
  decodeImage,
  factsOf,
  parseBrandingBody,
  type BrandingSummary,
  type ImageKind,
  type ImageType,
} from './branding-rules';
import { BRANDING_STORE, BrandingStore } from './branding.store';

import type { Gate } from '../platform';

@Injectable()
export class BrandingService {
  constructor(
    @Inject(AUTH_STORE) private readonly auth: AuthStore,
    @Inject(BRANDING_STORE) private readonly store: BrandingStore,
  ) {}

  /** Public: what every page needs to draw the brand. */
  async summary(): Promise<BrandingSummary> {
    return brandingSummary(await this.store.loadFacts());
  }

  /**
   * Public: the bytes of one image and the row's version (as GET /branding answers it), or null when unset.
   * The dark logo falls back to the light one.
   */
  async image(kind: ImageKind): Promise<{ type: ImageType; bytes: Buffer; version: number } | null> {
    const row = await this.store.loadImage(kind);
    if (!row) return null;
    const decoded = decodeImage(row.source);
    return decoded ? { ...decoded, version: row.updatedAt.getTime() } : null;
  }

  /** The branch owner, in their own full session, replaces the identity. */
  async save(gate: Gate, body: unknown): Promise<BrandingSummary> {
    await this.assertOwner(gate);
    const parsed = parseBrandingBody(body);
    return brandingSummary(factsOf(await this.store.save(parsed)));
  }

  private async assertOwner(gate: Gate): Promise<void> {
    if (!gate.sessionId) throw new ApiFailure(401, 'LOGIN_REQUIRED');
    const live = await this.auth.liveSession(gate.sessionId);
    if (!live || live.session.scope !== 'full' || live.user.disabledAt) throw new ApiFailure(401, 'LOGIN_REQUIRED');
    const owner = live.user.layer === 'branch' && live.user.isBranchOwner && live.session.kind !== 'impersonation';
    if (!owner) throw new ApiFailure(403, 'FORBIDDEN');
  }
}
