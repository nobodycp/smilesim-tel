import { Inject, Injectable } from '@nestjs/common';
import { AUTH_STORE, AuthStore } from '../auth/auth.store';
import { OfficeFailure } from '../shared/office-failure';
import {
  brandingSummary,
  decodeImage,
  parseBrandingBody,
  type BrandingSummary,
  type ImageType,
} from './branding-rules';
import { BRANDING_STORE, BrandingStore } from './branding.store';

import type { Gate } from '../shared/cookies';
export type ImageKind = 'logo' | 'logo-dark' | 'favicon';

@Injectable()
export class BrandingService {
  constructor(
    @Inject(AUTH_STORE) private readonly auth: AuthStore,
    @Inject(BRANDING_STORE) private readonly store: BrandingStore,
  ) {}

  /** Public: what every page needs to draw the brand. */
  async summary(): Promise<BrandingSummary> {
    return brandingSummary(await this.store.load());
  }

  /** Public: the bytes of one image, or null when unset. The dark logo falls back to the light one. */
  async image(kind: ImageKind): Promise<{ type: ImageType; bytes: Buffer } | null> {
    const row = await this.store.load();
    if (!row) return null;
    const source = kind === 'favicon' ? row.favicon : kind === 'logo-dark' ? row.logoDark ?? row.logo : row.logo;
    return decodeImage(source);
  }

  /** The branch owner, in their own full session, replaces the identity. */
  async save(gate: Gate, body: unknown): Promise<BrandingSummary> {
    await this.assertOwner(gate);
    const parsed = parseBrandingBody(body);
    return brandingSummary(await this.store.save(parsed));
  }

  private async assertOwner(gate: Gate): Promise<void> {
    if (!gate.sessionId) throw new OfficeFailure(401, 'LOGIN_REQUIRED');
    const live = await this.auth.liveSession(gate.sessionId);
    if (!live || live.session.scope !== 'full' || live.user.disabledAt) throw new OfficeFailure(401, 'LOGIN_REQUIRED');
    const owner = live.user.layer === 'branch' && live.user.isBranchOwner && live.session.kind !== 'impersonation';
    if (!owner) throw new OfficeFailure(403, 'FORBIDDEN');
  }
}
