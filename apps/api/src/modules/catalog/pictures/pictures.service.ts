import { Injectable } from '@nestjs/common';
import { decodePicture, markVersion, type PictureType } from '../rules/pictures';
import { PicturesRepository } from './pictures.repository';

export type Picture = { type: PictureType; bytes: Buffer; version: string };

/**
 * The bytes behind the picture URLs the lists carry (speed plan PF.7). Public, like the branding pictures (spec
 * decision 10): a company mark and an advertising picture are not secrets. A company answers by its public code;
 * an offer by its UUID, live or not (the id of an offer never shown reaches only those who list every offer).
 */
@Injectable()
export class PicturesService {
  constructor(private readonly repo: PicturesRepository) {}

  /** A company's mark and its version (the MD5 of the stored data URL); null when there is none. */
  async companyMark(code: string): Promise<Picture | null> {
    const image = await this.repo.companyImage(code);
    const decoded = decodePicture(image);
    return decoded && image ? { ...decoded, version: markVersion(image) } : null;
  }

  /** An offer's picture and its version (`updatedAt` in milliseconds); null when there is none. */
  async offerPicture(id: string): Promise<Picture | null> {
    const row = await this.repo.offerImage(id);
    const decoded = decodePicture(row?.image);
    return decoded && row ? { ...decoded, version: String(row.updatedAt.getTime()) } : null;
  }
}
