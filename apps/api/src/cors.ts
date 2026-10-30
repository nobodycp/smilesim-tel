import type { INestApplication } from '@nestjs/common';
import { DOOR_HOSTS } from './doors';

export const LOCAL_WEB_ORIGIN = 'http://localhost:3000';

const LOCAL_DOORS = DOOR_HOSTS.map((door) => `http://${door.host}.localhost:3000`);

function allowedOrigins(): string[] {
  const configured = (process.env.WEB_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return [LOCAL_WEB_ORIGIN, ...LOCAL_DOORS];
}

/** The browser lives on another origin and sends the session cookie, so credentials are on. */
export function enableWebCors(app: INestApplication): void {
  const allowed = new Set(allowedOrigins());
  app.enableCors({
    origin: (origin, callback) => callback(null, !origin || allowed.has(origin)),
    credentials: true,
  });
}
