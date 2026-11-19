import { Injectable } from '@nestjs/common';
import { decodePicture } from '../rules/pictures';
import { OfferPicturesRepository } from './offer-pictures.repository';
import type { Picture } from './send-picture';

/**
 * The bytes behind an offer's picture URL (speed plan PF.7). Public, like the branding pictures (spec decision 10):
 * an advertising picture is not a secret. An offer answers by its UUID, live or not (the id of an offer never shown
 * reaches only those who list every offer).
 */
@Injectable()
export class OfferPicturesService {
  constructor(private readonly repo: OfferPicturesRepository) {}

  /** An offer's picture and its version (`updatedAt` in milliseconds); null when there is none. */
  async offerPicture(id: string): Promise<Picture | null> {
    const row = await this.repo.offerImage(id);
    const decoded = decodePicture(row?.image);
    return decoded && row ? { ...decoded, version: String(row.updatedAt.getTime()) } : null;
  }
}
