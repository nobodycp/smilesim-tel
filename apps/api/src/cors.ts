import type { INestApplication } from '@nestjs/common';

export const LOCAL_WEB_ORIGIN = 'http://localhost:3000';

/** The browser lives on another origin and sends the session cookie, so credentials are on. */
export function enableWebCors(app: INestApplication): void {
  app.enableCors({ origin: process.env.WEB_ORIGIN || LOCAL_WEB_ORIGIN, credentials: true });
}
