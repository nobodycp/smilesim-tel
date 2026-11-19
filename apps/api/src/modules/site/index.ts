// The public surface of the site module (ADR 0020, amended 2026-11-19): what other modules may import from it. The
// site is what every business line shares on the home page and the frame of the app: the site identity
// (`branding/`), the offers and their pictures, and how a picture is served. A module imports another through its
// surface only (`module-surface`, architecture-boundaries.spec.ts); the composition roots (`app`) and the specs may
// reach inside.

export { PICTURES_PATH, decodePicture } from './rules/pictures';
export type { PictureType } from './rules/pictures';
export { PictureQuery } from './pictures/pictures.schemas';
export { sendPicture } from './pictures/send-picture';
export type { Picture } from './pictures/send-picture';
