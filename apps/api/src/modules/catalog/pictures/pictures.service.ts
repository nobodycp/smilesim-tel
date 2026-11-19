import { Injectable } from '@nestjs/common';
import { decodePicture, type Picture } from '../../site';
import { markVersion } from '../rules/pictures';
import { PicturesRepository } from './pictures.repository';

/**
 * The bytes behind a company mark's URL (speed plan PF.7). Public, like the branding pictures (spec decision 10): a
 * company mark is not a secret. A company answers by its public code. An offer's picture is the site's
 * (`site/pictures/offer-pictures.service.ts`).
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
}
