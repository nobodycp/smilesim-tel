import { fail } from '../../shared/office-failure';
import { decodeFeedCursor } from '../rules/office-paging';

/** The position a feed cursor points at; a cursor this API did not issue is 400 INVALID. */
export function feedPosition(raw: string | undefined) {
  const position = decodeFeedCursor(raw);
  if (position === null) fail(400, 'INVALID');
  return position;
}
