import type { Response } from 'express';
import { errorBody, parseInput } from '../../platform';
import { imageCacheControl } from '../branding/branding-rules';
import type { PictureType } from '../rules/pictures';
import { PictureQuery } from './pictures.schemas';

export type Picture = { type: PictureType; bytes: Buffer; version: string };

/**
 * How every picture route answers (speed plan PF.7): the bytes and their type, immutable for a year only under the
 * current `?v=`, else `no-cache`, with the version as the `ETag`; a `404` when there is no picture.
 */
export function sendPicture(res: Response, picture: Picture | null, query: PictureQuery) {
  if (!picture) {
    res.status(404).json(errorBody('NOT_FOUND'));
    return;
  }
  res.setHeader('Content-Type', picture.type);
  res.setHeader('Cache-Control', imageCacheControl(parseInput(PictureQuery, query).v, picture.version));
  res.setHeader('ETag', `"${picture.version}"`);
  res.send(picture.bytes);
}
